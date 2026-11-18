import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 처리 서버 설정이 필요합니다.' });
  const { organizationId, from, to } = req.query || {};
  if (!DATE_PATTERN.test(from || '') || !DATE_PATTERN.test(to || '') || from > to) return res.status(400).json({ ok: false, error: '조회 기간을 확인해 주세요.' });
  const auth = await authorizeFinance(req, organizationId, { permissionsAny: ['finance.view', 'expense.manage', 'expense.card.manage'] });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '재무 조회 권한이 필요합니다.' });
  const organization = encodeURIComponent(organizationId);
  const tasks = [
    ['expenses', `timefit_user_expenses?organization_id=eq.${organization}&transaction_date=gte.${from}&transaction_date=lte.${to}&select=id,ledger_entry_id,transaction_date,total_amount,supply_amount,vat_amount,merchant_name,merchant_business_number,category,reason,status,source_confidence,confirmed_at,created_at,staff:timefit_user_staff(display_name,department),sources:timefit_user_expense_sources(id,source_type,source_id,is_primary)&order=transaction_date.desc,created_at.desc&limit=500`],
    ['cards', `timefit_user_corporate_cards?organization_id=eq.${organization}&archived_at=is.null&select=id,issuer,nickname,last4,holder_staff_id,status,provider,last_synced_at,holder:timefit_user_staff(display_name)&order=created_at.desc`],
    ['cardTransactions', `timefit_user_card_transaction_groups?organization_id=eq.${organization}&approved_at=gte.${from}T00:00:00%2B09:00&approved_at=lte.${to}T23:59:59%2B09:00&select=*,card:timefit_user_corporate_cards(issuer,nickname,last4)&order=approved_at.desc&limit=500`],
    ['bankAccounts', `timefit_user_business_bank_accounts?organization_id=eq.${organization}&select=id,bank_name,display_name,last4,balance,currency,status,last_synced_at,provider&order=created_at.desc`],
    ['bankTransactions', `timefit_user_bank_transactions?organization_id=eq.${organization}&occurred_at=gte.${from}T00:00:00%2B09:00&occurred_at=lte.${to}T23:59:59%2B09:00&select=id,bank_account_id,provider,provider_transaction_id,occurred_at,direction,amount,balance_after,description,account:timefit_user_business_bank_accounts(bank_name,display_name,last4)&order=occurred_at.desc&limit=500`],
    ['documents', `timefit_user_finance_documents?organization_id=eq.${organization}&created_at=gte.${from}T00:00:00%2B09:00&created_at=lte.${to}T23:59:59%2B09:00&select=id,title,file_name,document_date,processing_status,review_status,extracted_data,cost_center_id,payment_method,created_at&order=created_at.desc&limit=500`],
  ];
  try {
    const settled = await Promise.allSettled(tasks.map(([, path]) => financeRest(path)));
    const data = {}; const warnings = [];
    settled.forEach((result, index) => {
      const key = tasks[index][0];
      if (result.status === 'fulfilled') data[key] = result.value || [];
      else { data[key] = []; warnings.push(key); }
    });
    return res.status(200).json({ ok: true, ...data, warnings, generatedAt: new Date().toISOString() });
  } catch (error) {
    return financeError(res, error, '재무 통합 데이터를 불러오지 못했습니다.');
  }
}
