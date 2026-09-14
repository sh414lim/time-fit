import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { codefBankProvider } from './providers/codef-card-provider.js';

const range = body => { const end = body?.to ? new Date(`${body.to}T23:59:59+09:00`) : new Date(); const start = body?.from ? new Date(`${body.from}T00:00:00+09:00`) : new Date(end.getTime() - 90 * 86400000); return { from: start.toISOString(), to: end.toISOString() }; };

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 연결 서버 설정이 필요합니다.' });
  const organizationId = req.method === 'GET' ? req.query?.organizationId : req.body?.organizationId;
  const auth = await authorizeFinance(req, organizationId);
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '관리자 인증이 필요합니다.' });
  try {
    if (req.method === 'GET') {
      const from = req.query?.from; const to = req.query?.to;
      let query = `timefit_user_bank_transactions?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,bank_account_id,occurred_at,direction,amount,balance_after,description,created_at,account:timefit_user_business_bank_accounts(bank_name,display_name,last4)&order=occurred_at.desc&limit=500`;
      if (from) query += `&occurred_at=gte.${encodeURIComponent(`${from}T00:00:00+09:00`)}`;
      if (to) query += `&occurred_at=lte.${encodeURIComponent(`${to}T23:59:59+09:00`)}`;
      return res.status(200).json({ ok: true, transactions: await financeRest(query) });
    }
    const window = range(req.body); const connectionId = req.body?.connectionId;
    const connections = await financeRest(`timefit_user_bank_connections?organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active${connectionId ? `&id=eq.${encodeURIComponent(connectionId)}` : ''}&select=*`);
    let imported = 0; let duplicates = 0;
    for (const connection of connections) {
      const accounts = await financeRest(`timefit_user_business_bank_accounts?connection_id=eq.${encodeURIComponent(connection.id)}&status=eq.active&select=*`);
      const provider = codefBankProvider(connection);
      for (const account of accounts) {
        const transactions = await provider.fetchTransactions({ account, ...window });
        for (const transaction of transactions) {
          const saved = await financeRest('timefit_user_bank_transactions?on_conflict=organization_id,provider,provider_transaction_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ organization_id: organizationId, bank_account_id: account.id, provider: 'codef', provider_transaction_id: transaction.providerTransactionId, occurred_at: transaction.occurredAt, direction: transaction.direction, amount: transaction.amount, balance_after: transaction.balanceAfter, description: transaction.description }]) });
          if (saved?.length) imported += 1; else duplicates += 1;
        }
        await financeRest(`timefit_user_business_bank_accounts?id=eq.${encodeURIComponent(account.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      }
    }
    return res.status(200).json({ ok: true, imported, duplicates });
  } catch (error) { return financeError(res, error, '법인계좌 거래내역을 가져오지 못했습니다.'); }
}
