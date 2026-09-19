import { decryptSecret } from './_integration-crypto.js';

const TOSS_API = "https://open-api.tossplace.com/api-public/openapi/v1";

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

async function authorizeManager(req, organizationId) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !organizationId) return false;
  const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userResponse.ok) return false;
  const user = await userResponse.json();
  const membershipResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(user.id)}&role=eq.manager&select=organization_id`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!membershipResponse.ok) return false;
  return (await membershipResponse.json()).length > 0;
}

function asDate(value) {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function normalizeOrder(order, merchantId, organizationId) {
  return {
    organization_id: organizationId,
    merchant_id: Number(merchantId),
    order_id: String(order.id),
    order_key: order.orderKey ?? null,
    state: order.orderState ?? order.state ?? null,
    source: order.source ?? null,
    ordered_at: asDate(order.createdAt ?? order.orderedAt),
    completed_at: asDate(order.completedAt),
    cancelled_at: asDate(order.cancelledAt),
    total_amount: Number(order.chargePrice?.totalAmount ?? order.totalAmount ?? order.totalPrice?.amount ?? order.amount) || 0,
    raw_order: order,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function upsertOrders(rows) {
  if (!rows.length) return;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tossplace_orders?on_conflict=merchant_id,order_id`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase order upsert failed: ${response.status}`);
}

async function saveSyncState(state) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tossplace_sync_state?on_conflict=merchant_id`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([state]),
  });
  if (!response.ok) throw new Error(`Supabase sync state write failed: ${response.status}`);
}

async function refreshDailySalesSummary(organizationId, merchantId) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/timefit_user_refresh_tossplace_daily_sales`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_organization_id: organizationId, p_merchant_id: Number(merchantId) }),
  });
  if (!response.ok) throw new Error(`Supabase daily summary refresh failed: ${response.status}`);
}

async function readConnections(organizationId) {
  const filter = organizationId
    ? `organization_id=eq.${encodeURIComponent(organizationId)}&sync_enabled=eq.true`
    : 'sync_enabled=eq.true&merchant_id=not.is.null';
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_tossplace_connections?${filter}&select=organization_id,merchant_id,service_id,service_code,credential_source,encrypted_access_key,encrypted_access_secret`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) throw new Error(`Supabase Toss connection read failed: ${response.status}`);
  const rows = await response.json();
  if (organizationId && !rows.length) throw new Error('Toss Place connection not found or disabled');
  return rows;
}

async function syncConnection({ organizationId, merchantId, page, size, mode, credentialSource, encryptedAccessKey, encryptedAccessSecret }) {
  const accessKey = credentialSource === 'custom' ? decryptSecret(encryptedAccessKey) : process.env.TOSSPLACE_ACCESS_KEY;
  const accessSecret = credentialSource === 'custom' ? decryptSecret(encryptedAccessSecret) : process.env.TOSSPLACE_ACCESS_SECRET;
  if (!accessKey || !accessSecret) throw new Error('Toss Place credentials are unavailable');
  const params = new URLSearchParams({ page: String(page), size: String(size), sortOrder: 'DESC' });
  if (mode === 'daily') params.set('from', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
  await saveSyncState({ merchant_id: Number(merchantId), organization_id: organizationId, last_sync_started_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString() });
  const response = await fetch(`${TOSS_API}/merchants/${merchantId}/order/orders?${params}`, {
    headers: { 'x-access-key': accessKey, 'x-secret-key': accessSecret, 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.resultType !== 'SUCCESS') {
    const detail = String(body?.error?.message || body?.message || body?.errorCode || '').slice(0, 160);
    if (response.status === 401) throw new Error('Toss Place 인증에 실패했습니다. Access Key·Secret과 POS 서비스 코드 연결을 확인해 주세요.');
    if (response.status === 403) throw new Error('Toss Place 주문 조회 권한이 없습니다. 해당 앱에 매장 주문 조회 권한이 있는지 확인해 주세요.');
    if (response.status === 404) throw new Error('Toss Place 판매점 ID 또는 주문 조회 경로를 확인해 주세요.');
    throw new Error(detail ? `Toss Place 주문 조회 실패 (${response.status}): ${detail}` : `Toss Place 주문 조회 실패 (${response.status})`);
  }
  const orders = Array.isArray(body.success) ? body.success : (body.success?.items ?? []);
  await upsertOrders(orders.filter(order => order?.id).map(order => normalizeOrder(order, merchantId, organizationId)));
  // Aggregation happens during background sync, never when a manager opens
  // the sales page. This keeps the dashboard read path consistently light.
  await refreshDailySalesSummary(organizationId, merchantId);
  await saveSyncState({ merchant_id: Number(merchantId), organization_id: organizationId, last_successful_sync_at: new Date().toISOString(), last_sync_started_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString() });
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_tossplace_connections?organization_id=eq.${encodeURIComponent(organizationId)}`, {
    method: 'PATCH', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ connection_status: 'connected', last_synced_at: new Date().toISOString(), last_error: null }),
  });
  return orders.length;
}

async function markConnectionError(organizationId, message) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_tossplace_connections?organization_id=eq.${encodeURIComponent(organizationId)}`, {
    method: 'PATCH',
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ connection_status: 'error', last_error: message.slice(0, 300) }),
  }).catch(() => {});
}

async function saveSyncFailure(organizationId, message) {
  if (!organizationId) return;
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/tossplace_sync_state?organization_id=eq.${encodeURIComponent(organizationId)}`, {
    method: 'PATCH',
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ last_sync_error: String(message || 'sync_failed').slice(0, 300), updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false, error: "Method not allowed" });

  const requestedOrganizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId : req.body?.organizationId || null;
  const cronRequest = isAuthorized(req);
  if (!cronRequest && !(req.method === 'POST' && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && await authorizeManager(req, requestedOrganizationId))) return res.status(401).json({ ok: false, error: '관리자 인증이 필요합니다.' });

  const required = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
  if (required.some(value => !value)) return res.status(503).json({ ok: false, error: "Missing server configuration" });

  const page = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
  const size = Math.min(500, Math.max(1, Number.parseInt(req.query.size ?? "500", 10) || 500));
  const mode = req.query.mode === "backfill" ? "backfill" : "daily";
  const organizationId = cronRequest ? requestedOrganizationId : requestedOrganizationId;

  try {
    const connections = await readConnections(organizationId);
    if (!connections.length) return res.status(200).json({ ok: true, mode, synchronized: 0, stores: 0, message: 'No enabled Toss Place store connection' });
    const results = [];
    for (const connection of connections) {
      if (!connection.merchant_id) continue;
      const count = await syncConnection({ organizationId: connection.organization_id, merchantId: connection.merchant_id, page, size, mode, credentialSource: connection.credential_source, encryptedAccessKey: connection.encrypted_access_key, encryptedAccessSecret: connection.encrypted_access_secret });
      results.push({ organizationId: connection.organization_id, synchronized: count });
    }
    return res.status(200).json({ ok: true, mode, page, synchronized: results.reduce((sum, item) => sum + item.synchronized, 0), stores: results.length, results });
  } catch (error) {
    if (organizationId) {
      await Promise.all([
        markConnectionError(organizationId, error.message || 'sync_failed'),
        saveSyncFailure(organizationId, error.message || 'sync_failed'),
      ]);
    }
    console.error("Toss Place sales sync failed", { organizationId, mode, page, message: error.message });
    const authFailure = /인증에 실패/.test(error.message || '');
    return res.status(authFailure ? 422 : 502).json({ ok: false, error: error.message || 'Toss Place 주문 동기화에 실패했습니다.', code: authFailure ? 'toss_auth_failed' : 'toss_sync_failed' });
  }
}
