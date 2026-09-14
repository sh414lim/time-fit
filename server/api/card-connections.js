import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { cardProvider, resolveCardProviderName } from './providers/card-provider.js';
import { codefConfigured } from './providers/codef-card-provider.js';

const publicConnection = connection => connection && ({
  id: connection.id,
  provider: connection.provider,
  business_type: connection.business_type,
  status: connection.status,
  consent_version: connection.consent_version,
  consented_at: connection.consented_at,
  last_attempted_at: connection.last_attempted_at,
  last_succeeded_at: connection.last_succeeded_at,
  next_sync_at: connection.next_sync_at,
  last_error_code: connection.last_error_code,
  last_error_category: connection.last_error_category,
  disconnected_at: connection.disconnected_at,
  created_at: connection.created_at,
});

export default async function handler(req, res) {
  if (!['GET','POST','DELETE'].includes(req.method)) return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 연결 서버 설정이 필요합니다.' });
  const organizationId = req.method === 'GET' ? req.query.organizationId : req.body?.organizationId;
  const auth = await authorizeFinance(req, organizationId, { ownerOnly: req.method !== 'GET' });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: req.method === 'GET' ? '관리자 인증이 필요합니다.' : '조직 소유자만 카드 연결을 변경할 수 있습니다.' });
  try {
    if (req.method === 'GET') {
      const connections = await financeRest(`timefit_user_card_connections?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,provider,business_type,status,consent_version,consented_at,last_attempted_at,last_succeeded_at,next_sync_at,last_error_code,last_error_category,created_at&order=created_at.desc`);
      return res.status(200).json({ ok: true, connections });
    }
    if (req.method === 'DELETE') {
      const connectionId = req.body?.connectionId;
      if (!connectionId) return res.status(400).json({ ok: false, error: '해제할 카드 연결을 확인해 주세요.' });
      const rows = await financeRest(`timefit_user_card_connections?id=eq.${encodeURIComponent(connectionId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=*`);
      const connection = rows[0];
      if (!connection || connection.status === 'disconnected') return res.status(404).json({ ok: false, error: '해제할 카드 연결을 찾지 못했습니다.' });
      const disconnectedAt = new Date().toISOString();
      const updated = await financeRest(`timefit_user_card_connections?id=eq.${encodeURIComponent(connectionId)}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'disconnected', credential_reference_encrypted: null, disconnected_at: disconnectedAt, next_sync_at: null, updated_at: disconnectedAt }),
      });
      await Promise.all([
        financeRest(`timefit_user_connection_assets?connection_id=eq.${encodeURIComponent(connectionId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'disconnected', updated_at: disconnectedAt }) }),
        financeRest(`timefit_user_corporate_cards?connection_id=eq.${encodeURIComponent(connectionId)}&archived_at=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'disconnected', archived_at: disconnectedAt, updated_at: disconnectedAt }) }),
        financeRest('timefit_user_expense_audit_logs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ organization_id: organizationId, entity_type: 'card_connection', entity_id: connectionId, action: 'disconnected', before_value: { provider: connection.provider, status: connection.status }, after_value: { provider: connection.provider, status: 'disconnected', disconnected_at: disconnectedAt }, actor_id: auth.user.id, source: 'manager_web' }]) }),
      ]);
      return res.status(200).json({ ok: true, connection: publicConnection(updated[0]) });
    }
    const providerName = resolveCardProviderName(req.body?.provider);
    if (providerName === 'hyphen' && (!process.env.HYPHEN_USER_ID || !process.env.HYPHEN_HKEY || !process.env.INTEGRATION_ENCRYPTION_KEY)) return res.status(503).json({ ok: false, code: 'provider_not_configured', error: '하이픈 연결정보와 암호화 키가 필요합니다.' });
    if (providerName === 'codef' && !codefConfigured({ requirePublicKey: true })) return res.status(503).json({ ok: false, code: 'provider_not_configured', error: 'CODEF Client ID, Client Secret, Public Key와 암호화 키가 필요합니다.' });
    const provider = cardProvider(providerName);
    const credential = await provider.authenticate(req.body?.authentication || {});
    const created = await financeRest('timefit_user_card_connections', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ organization_id: organizationId, provider: providerName, business_type: req.body?.businessType === 'sole_proprietor' ? 'sole_proprietor' : 'corporation', status: 'authenticating', credential_reference_encrypted: credential.credentialReference, consent_version: String(req.body?.consentVersion || '2026-09-10'), consented_by: auth.user.id, consented_at: new Date().toISOString(), created_by: auth.user.id }]),
    });
    return res.status(201).json({ ok: true, connection: publicConnection(created[0]) });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ ok: false, error: '이미 진행 중인 카드 연결이 있습니다.' });
    return financeError(res, error, '카드 연결을 저장하지 못했습니다.');
  }
}
