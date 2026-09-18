import { decryptSecret } from './_integration-crypto.js';
import { authorizeFinance, financeRest } from './_finance-server.js';
import { advanceSalesJob } from './_sales-sync-job.js';

const TOSS_API = 'https://open-api.tossplace.com/api-public/openapi/v1';
const asDate = value => value && Number.isFinite(Date.parse(value)) ? value : null;
export function normalizeOrder(order, merchantId, organizationId) {
  const amount = Number(order.chargePrice?.totalAmount ?? order.totalAmount ?? order.totalPrice?.amount ?? order.amount);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid Toss Place order amount');
  return {
    organization_id: organizationId, merchant_id: Number(merchantId), order_id: String(order.id),
    order_key: order.orderKey ?? null, state: order.orderState ?? order.state ?? null, source: order.source ?? null,
    ordered_at: asDate(order.createdAt ?? order.orderedAt), completed_at: asDate(order.completedAt), cancelled_at: asDate(order.cancelledAt),
    total_amount: amount, raw_order: order, synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  const deadline = Date.now() + 45000;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ ok: false, error: 'Missing server configuration' });
  const organizationId = typeof req.query?.organizationId === 'string' ? req.query.organizationId : req.body?.organizationId || null;
  const cronRequest = Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  try {
    if (!cronRequest && !(req.method === 'POST' && await authorizeFinance(req, organizationId))) return res.status(401).json({ ok: false, error: '관리자 인증이 필요합니다.' });
    if (req.query?.page !== undefined || req.query?.size !== undefined) return res.status(400).json({ ok: false, error: '페이지는 동기화 작업이 자동 관리합니다.' });
    const filter = organizationId ? `organization_id=eq.${encodeURIComponent(organizationId)}&` : '';
    const connections = await financeRest(`timefit_user_tossplace_connections?${filter}sync_enabled=eq.true&merchant_id=not.is.null&select=organization_id,merchant_id&order=last_synced_at.asc.nullsfirst,organization_id.asc`);
    if (organizationId && !connections.length) return res.status(404).json({ ok: false, error: '사용 가능한 매장 연결이 없습니다.' });
    const results = [];
    for (const [index, connection] of connections.entries()) {
      const identity = { organizationId: connection.organization_id };
      const timeLeft = deadline - Date.now();
      if (timeLeft < 3000) { results.push({ ...identity, status: 'pending', synchronized: 0 }); continue; }
      const storeDeadline = Date.now() + Math.min(8000, Math.floor(timeLeft / (connections.length - index)));
      try {
        const result = await advanceSalesJob({
          organizationId: connection.organization_id, merchantId: connection.merchant_id,
          backfill: req.query?.mode === 'backfill',
          headersForJob: job => {
            const accessKey = job.credential_source === 'custom' ? decryptSecret(job.encrypted_access_key) : process.env.TOSSPLACE_ACCESS_KEY;
            const accessSecret = job.credential_source === 'custom' ? decryptSecret(job.encrypted_access_secret) : process.env.TOSSPLACE_ACCESS_SECRET;
            if (!accessKey || !accessSecret) throw new Error('Toss Place credentials are unavailable');
            return { 'x-access-key': accessKey, 'x-secret-key': accessSecret };
          },
          url: `${TOSS_API}/merchants/${connection.merchant_id}/order/orders`,
          normalize: order => normalizeOrder(order, connection.merchant_id, connection.organization_id),
          rpc: (name, args) => financeRest(`rpc/${name}`, {
            method: 'POST', body: JSON.stringify(args),
            signal: AbortSignal.timeout(name === 'timefit_user_release_sales_job' ? 2000 : Math.max(1, storeDeadline - Date.now())),
          }), deadline: storeDeadline,
        });
        results.push({ ...identity, ...result });
      } catch (error) {
        console.error('Toss Place store sync failed', { ...identity, message: error.message });
        const message = /Merchant ownership conflict/.test(error.detail || error.message)
          ? '같은 매장에 활성 연결 또는 다른 사업장의 주문이 남아 있습니다. 매장 소유권과 연결을 확인해 주세요.'
          : /Connection changed or disabled/.test(error.detail || error.message)
            ? '수집 중 매장 연결이 변경됐습니다. 연결 정보를 확인한 뒤 다시 동기화해 주세요.' : error.message;
        results.push({ ...identity, status: 'failed', synchronized: 0, error: message });
      }
    }
    const failed = results.filter(result => result.status === 'failed').length;
    const pending = results.filter(result => ['pending', 'running'].includes(result.status)).length;
    const status = failed ? 'partial_failure' : pending ? 'pending' : 'completed';
    return res.status(organizationId && failed ? 502 : organizationId && pending ? 202 : 200).json({
      ok: failed === 0, status, synchronized: results.reduce((sum, result) => sum + result.synchronized, 0),
      stores: results.length, failed, pending, results,
      message: pending ? '수집 중입니다. 예약 실행 또는 다시 동기화로 이어서 처리합니다.' : undefined,
      error: organizationId && failed ? results[0].error : undefined,
    });
  } catch (error) {
    console.error('Toss Place sales sync failed', { organizationId, message: error.message });
    return res.status(502).json({ ok: false, error: '매출 동기화를 시작하지 못했습니다.' });
  }
}
