import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { codefBankProvider, codefConfigured } from './providers/codef-card-provider.js';

const publicConnection = row => ({ id: row.id, provider: row.provider, bank_code: row.bank_code, status: row.status, last_succeeded_at: row.last_succeeded_at, disconnected_at: row.disconnected_at, created_at: row.created_at });

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 연결 서버 설정이 필요합니다.' });
  const organizationId = req.method === 'GET' ? req.query?.organizationId : req.body?.organizationId;
  const auth = await authorizeFinance(req, organizationId, { ownerOnly: req.method !== 'GET' });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: req.method === 'GET' ? '관리자 인증이 필요합니다.' : '조직 소유자만 법인계좌 연결을 변경할 수 있습니다.' });
  try {
    if (req.method === 'GET') {
      const [connections, accounts] = await Promise.all([
        financeRest(`timefit_user_bank_connections?organization_id=eq.${encodeURIComponent(organizationId)}&status=neq.disconnected&select=id,provider,bank_code,status,last_succeeded_at,disconnected_at,created_at&order=created_at.desc`),
        financeRest(`timefit_user_business_bank_accounts?organization_id=eq.${encodeURIComponent(organizationId)}&status=neq.disconnected&select=id,connection_id,bank_name,display_name,last4,balance,currency,status,last_synced_at&order=created_at.desc`),
      ]);
      return res.status(200).json({ ok: true, connections, accounts });
    }
    if (req.method === 'DELETE') {
      const connectionId = req.body?.connectionId; const now = new Date().toISOString();
      if (!connectionId) return res.status(400).json({ ok: false, error: '해제할 계좌 연결을 확인해 주세요.' });
      const rows = await financeRest(`timefit_user_bank_connections?id=eq.${encodeURIComponent(connectionId)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=neq.disconnected&select=*`);
      if (!rows.length) return res.status(404).json({ ok: false, error: '계좌 연결을 찾지 못했습니다.' });
      await codefBankProvider(rows[0]).disconnect();
      const updated = await financeRest(`timefit_user_bank_connections?id=eq.${encodeURIComponent(connectionId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'disconnected', credential_reference_encrypted: null, disconnected_at: now, updated_at: now }) });
      await financeRest(`timefit_user_business_bank_accounts?connection_id=eq.${encodeURIComponent(connectionId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'disconnected', account_reference_encrypted: null, updated_at: now }) });
      return res.status(200).json({ ok: true, connection: publicConnection(updated[0]) });
    }
    if (!codefConfigured({ requirePublicKey: true })) return res.status(503).json({ ok: false, error: 'CODEF 연결 설정이 필요합니다.' });
    const authentication = req.body?.authentication || {};
    const credential = await codefBankProvider().authenticate(authentication);
    const created = await financeRest('timefit_user_bank_connections', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ organization_id: organizationId, provider: 'codef', bank_code: authentication.organization, status: 'authenticating', credential_reference_encrypted: credential.credentialReference, consent_version: '2026-09-12-bank-v1', consented_by: auth.user.id, consented_at: new Date().toISOString(), created_by: auth.user.id }]) });
    const connection = created[0];
    const accounts = await codefBankProvider(connection).listAccounts();
    const now = new Date().toISOString();
    const saved = accounts.length ? await financeRest('timefit_user_business_bank_accounts?on_conflict=connection_id,provider_account_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(accounts.map(account => ({ organization_id: organizationId, connection_id: connection.id, provider: 'codef', provider_account_id: account.providerAccountId, account_reference_encrypted: account.accountReference, bank_name: account.bankName, display_name: account.displayName, last4: account.last4, balance: account.balance, currency: account.currency, status: 'active', last_synced_at: now }))) }) : [];
    const updated = await financeRest(`timefit_user_bank_connections?id=eq.${encodeURIComponent(connection.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'active', last_succeeded_at: now, updated_at: now }) });
    return res.status(201).json({ ok: true, connection: publicConnection(updated[0]), accounts: saved.map(({ account_reference_encrypted, ...account }) => account) });
  } catch (error) {
    return financeError(res, error, '법인계좌를 연결하지 못했습니다. 은행 인증정보와 CODEF 지원 상태를 확인해 주세요.');
  }
}
