import test from 'node:test';
import assert from 'node:assert/strict';
import cardConnections from '../server/api/card-connections.js';
import bankConnections from '../server/api/bank-connections.js';
import bankTransactions from '../server/api/bank-transactions.js';
import cardConnectionReauth from '../server/api/card-connection-reauth.js';
import cardSync from '../server/api/card-sync.js';
import cardSyncExecute from '../server/api/card-sync-execute.js';
import cardSyncWorker from '../server/api/card-sync-worker.js';
import { matchScore, matchingClassificationRule, receiptFingerprint, receiptRetryBlocker, structuredReceipt } from '../server/api/receipt-process.js';
import expenseReview, { eligibleBulkMatches } from '../server/api/expense-review.js';
import { buildCloseoutCompleteness, buildDailyLaborMap, buildFinanceReport, compareFinanceReports, groupFinanceSeries, previousFinanceRange } from '../server/api/finance-report.js';
import closeouts from '../server/api/closeouts.js';
import { mergeReceiptExtractions, validateReceiptExtraction } from '../server/api/_receipt-llm.js';
import { buildExpenseExceptions } from '../server/api/expense-exceptions.js';
import expenseReminderWorker, { dueReminderNumber } from '../server/api/expense-reminder-worker.js';
import { analyzeReceiptPixels } from '../src/features/finance/receiptQuality.js';
import expenses, { provisionalCardExpense, summarizeExpenses, validateManualExpense } from '../server/api/expenses.js';
import expenseDetail from '../server/api/expense-detail.js';
import { expenseLedgerCsv } from '../src/features/finance/expenseExport.js';
import { financeReportCsvRows } from '../src/features/finance/financeReportExport.js';
import { normalizeHyphenCards, normalizeHyphenEvents } from '../server/api/providers/hyphen-card-provider.js';
import { codefBaseUrl, normalizeCodefBankAccounts, normalizeCodefBankTransactions, normalizeCodefCards, normalizeCodefEvents, normalizeCodefPurchases } from '../server/api/providers/codef-card-provider.js';
import { cardRetryPlan, cardSyncErrorCategory, cardSyncWindow } from '../server/api/_card-sync-runner.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const configure = () => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
};

test('카드 연결 API는 로그인하지 않은 요청을 차단한다', async () => {
  configure();
  const res = responseRecorder();
  await cardConnections({ method: 'POST', headers: {}, body: { organizationId: 'org', provider: 'mock' } }, res);
  assert.equal(res.statusCode, 401);
});

test('CODEF 환경은 샌드박스 URL을 기본값으로 사용한다', () => {
  const before = process.env.CODEF_ENV;
  delete process.env.CODEF_ENV;
  try { assert.equal(codefBaseUrl(), 'https://sandbox.codef.io'); }
  finally { if (before === undefined) delete process.env.CODEF_ENV; else process.env.CODEF_ENV = before; }
});

test('CODEF 법인 보유카드를 PAN 없이 안정 식별자로 정규화한다', () => {
  const cards = normalizeCodefCards({ data: [{ resCardNo: '1234-****-****-4821', resCardName: '비즈카드', resIssueDate: '20250101', resSleepYn: '0' }] }, '0301');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].last4, '4821');
  assert.match(cards[0].providerAssetId, /^codef-card-[a-f0-9]{32}$/);
  assert.equal(cards[0].providerAssetId.includes('1234'), false);
});

test('CODEF 승인·부분취소·거절을 표준 이벤트로 정규화한다', () => {
  const shared = { resCardNo: '1234-****-****-4821', resUsedDate: '20260912', resUsedTime: '093000', resApprovalNo: 'A100', resMemberStoreName: '테스트마트' };
  const events = normalizeCodefEvents({ data: [
    { ...shared, resUsedAmount: '120,000', resCancelYN: '0', resVAT: '10909' },
    { ...shared, resUsedTime: '103000', resUsedAmount: '20,000', resCancelAmount: '20,000', resCancelYN: '2' },
    { ...shared, resUsedTime: '113000', resUsedAmount: '5,000', resCancelYN: '3' },
  ] }, '0301');
  assert.deepEqual(events.map(event => event.eventType), ['approval', 'partial_cancellation', 'declined']);
  assert.equal(events[0].amount, 120000);
  assert.equal(events[0].vatAmount, 10909);
  assert.equal(events[1].amount, 20000);
  assert.equal(events[0].groupKey, events[1].groupKey);
});

test('CODEF 매입내역을 승인 그룹의 acquisition 이벤트로 정규화한다', () => {
  const events = normalizeCodefPurchases({ data: [{ resCardNo: '1234-****-****-4821', resUsedDate: '20260912', resUsedTime: '093000', resPurchaseDate: '20260913', resApprovalNo: 'A100', resUsedAmount: '120000', resMemberStoreName: '테스트마트' }] }, '0301');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'acquisition');
  assert.equal(events[0].amount, 120000);
  assert.equal(events[0].occurredAt, '2026-09-13T00:30:00.000Z');
});

test('CODEF 법인 보유계좌는 계좌번호 원문 없이 정규화한다', () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  const accounts = normalizeCodefBankAccounts({ data: [{ resAccount: '123-456-789012', resAccountName: '운영계좌', resBankName: 'KB국민은행', resAccountBalance: '1,250,000' }] }, '0004');
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].last4, '9012');
  assert.equal(accounts[0].balance, 1250000);
  assert.equal(JSON.stringify(accounts).includes('123-456-789012'), false);
});

test('법인계좌 연결 API는 로그인하지 않은 등록을 차단한다', async () => {
  configure(); const res = responseRecorder();
  await bankConnections({ method: 'POST', headers: {}, body: { organizationId: 'org-1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('CODEF 법인계좌 입출금 내역을 중복 식별 가능한 모델로 변환한다', () => {
  const rows = normalizeCodefBankTransactions({ data: { resTrHistoryList: [
    { resAccountTrDate: '20260912', resAccountTrTime: '093000', resAccountOut: '120,000', resAccountIn: '0', resAfterTranBalance: '880000', resAccountDesc1: '식자재마트', resAccountDesc2: '인터넷' },
    { resAccountTrDate: '20260912', resAccountTrTime: '103000', resAccountOut: '0', resAccountIn: '300,000', resAfterTranBalance: '1180000', resAccountDesc1: '매출입금' },
  ] } }, 'account-1');
  assert.deepEqual(rows.map(item => [item.direction, item.amount]), [['withdrawal', 120000], ['deposit', 300000]]);
  assert.match(rows[0].providerTransactionId, /^codef-bank-tx-/);
  assert.equal(rows[0].description, '식자재마트 · 인터넷');
});

test('법인계좌 거래내역 API는 로그인하지 않은 동기화를 차단한다', async () => {
  configure(); const res = responseRecorder();
  await bankTransactions({ method: 'POST', headers: {}, body: { organizationId: 'org-1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('조직 소유자는 Mock 카드 연결 초안을 생성한다', async () => {
  configure();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (String(url).includes('/timefit_user_organizations')) return jsonResponse([{ id: 'org-1', owner_id: 'user-1' }]);
    if (String(url).endsWith('/rest/v1/timefit_user_card_connections')) return jsonResponse([{ id: 'connection-1', provider: 'mock', status: 'authenticating' }], 201);
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const res = responseRecorder();
    await cardConnections({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { organizationId: 'org-1', provider: 'mock', businessType: 'corporation', consentVersion: 'test-v1' } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.connection.provider, 'mock');
    assert.equal('credential_reference_encrypted' in res.body.connection, false);
    const saved = JSON.parse(calls.at(-1).options.body)[0];
    assert.equal(saved.organization_id, 'org-1');
    assert.equal(saved.consented_by, 'user-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('카드 연결 해제는 자격정보를 폐기하고 연결 카드와 자산을 중지한다', async () => {
  configure();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url); calls.push({ value, options });
    if (value.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (value.includes('/timefit_user_organizations')) return jsonResponse([{ id: 'org-1', owner_id: 'user-1' }]);
    if (value.includes('/timefit_user_card_connections?') && (!options.method || options.method === 'GET')) return jsonResponse([{ id: 'connection-1', organization_id: 'org-1', provider: 'codef', status: 'active', credential_reference_encrypted: 'encrypted-secret' }]);
    if (value.includes('/timefit_user_card_connections?') && options.method === 'PATCH') return jsonResponse([{ id: 'connection-1', provider: 'codef', status: 'disconnected', credential_reference_encrypted: null }]);
    if (value.includes('/timefit_user_connection_assets?') || value.includes('/timefit_user_corporate_cards?')) return jsonResponse(null);
    if (value.endsWith('/rest/v1/timefit_user_expense_audit_logs')) return jsonResponse(null, 201);
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const res = responseRecorder();
    await cardConnections({ method: 'DELETE', headers: { authorization: 'Bearer user-token' }, body: { organizationId: 'org-1', connectionId: 'connection-1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connection.status, 'disconnected');
    assert.equal('credential_reference_encrypted' in res.body.connection, false);
    const connectionPatch = calls.find(call => call.value.includes('/timefit_user_card_connections?') && call.options.method === 'PATCH');
    assert.equal(JSON.parse(connectionPatch.options.body).credential_reference_encrypted, null);
    assert.equal(calls.some(call => call.value.includes('/timefit_user_connection_assets?') && call.options.method === 'PATCH'), true);
    assert.equal(calls.some(call => call.value.includes('/timefit_user_corporate_cards?') && call.options.method === 'PATCH'), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('카드 재인증 API는 소유자 확인 없이 인증정보를 바꾸지 않는다', async () => {
  configure();
  const res = responseRecorder();
  await cardConnectionReauth({ method: 'POST', headers: {}, body: { organizationId: 'org-1', connectionId: 'connection-1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('카드 재인증은 검증 후 연결을 복구하고 비밀값 없는 감사 이력을 남긴다', async () => {
  configure();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url); calls.push({ value, options });
    if (value.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (value.includes('/timefit_user_organizations')) return jsonResponse([{ id: 'org-1', owner_id: 'user-1' }]);
    if (value.includes('/timefit_user_card_connections?') && (!options.method || options.method === 'GET')) return jsonResponse([{ id: 'connection-1', organization_id: 'org-1', provider: 'mock', status: 'reauth_required', last_error_code: '401' }]);
    if (value.includes('/timefit_user_card_connections?') && options.method === 'PATCH') return jsonResponse([{ id: 'connection-1', provider: 'mock', status: 'active', last_error_code: null }]);
    if (value.endsWith('/rest/v1/timefit_user_expense_audit_logs')) return jsonResponse(null, 201);
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const res = responseRecorder();
    await cardConnectionReauth({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { organizationId: 'org-1', connectionId: 'connection-1', authentication: {} } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connection.status, 'active');
    assert.equal('credential_reference_encrypted' in res.body.connection, false);
    const auditCall = calls.find(call => call.value.endsWith('/rest/v1/timefit_user_expense_audit_logs'));
    const audit = JSON.parse(auditCall.options.body)[0];
    assert.equal(audit.action, 'credentials_refreshed');
    assert.equal(JSON.stringify(audit).includes('password'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('동일 백필 요청은 기존 동기화 작업을 반환한다', async () => {
  configure();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (value.includes('/timefit_user_organizations')) return jsonResponse([{ id: 'org-1', owner_id: 'user-1' }]);
    if (value.includes('/timefit_user_card_connections')) return jsonResponse([{ id: 'connection-1', organization_id: 'org-1', provider: 'mock' }]);
    if (value.includes('/timefit_user_card_sync_runs')) return jsonResponse([{ id: 'run-1', status: 'succeeded', idempotency_key: 'connection-1:backfill:initial' }]);
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const res = responseRecorder();
    await cardSync({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { organizationId: 'org-1', connectionId: 'connection-1', mode: 'backfill' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicateRequest, true);
    assert.equal(res.body.run.id, 'run-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('신규 카드 동기화 요청은 Provider를 기다리지 않고 작업만 접수한다', async () => {
  configure();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url); calls.push({ value, options });
    if (value.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (value.includes('/timefit_user_organizations')) return jsonResponse([{ id: 'org-1', owner_id: 'user-1' }]);
    if (value.includes('/timefit_user_card_connections')) return jsonResponse([{ id: 'connection-1', organization_id: 'org-1', provider: 'codef' }]);
    if (value.includes('/timefit_user_card_sync_runs?')) return jsonResponse([]);
    if (value.endsWith('/rest/v1/timefit_user_card_sync_runs') && options.method === 'POST') return jsonResponse([{ id: 'run-queued', status: 'queued' }], 201);
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const res = responseRecorder();
    await cardSync({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { organizationId: 'org-1', connectionId: 'connection-1', mode: 'backfill' } }, res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.queued, true);
    assert.equal(res.body.runId, 'run-queued');
    assert.equal(calls.some(call => call.value.includes('sandbox.codef.io')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('수동 카드 동기화 실행은 로그인하지 않은 요청을 차단한다', async () => {
  configure();
  const res = responseRecorder();
  await cardSyncExecute({ method: 'POST', headers: {}, body: { organizationId: 'org-1', runId: 'run-1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('수동 카드 동기화는 큐 작업을 즉시 실행한다', async () => {
  configure();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url); calls.push({ value, options });
    if (value.includes('/auth/v1/user')) return jsonResponse({ id: 'user-1' });
    if (value.includes('/timefit_user_organizations')) return jsonResponse([{ id: 'org-1', owner_id: 'user-1' }]);
    if (value.includes('/timefit_user_card_sync_runs?') && options.method === 'PATCH') return jsonResponse([{ id: 'run-1', organization_id: 'org-1', connection_id: 'connection-1', idempotency_key: 'connection-1:backfill:initial', status: 'running' }]);
    if (value.includes('/timefit_user_card_connections?') && (!options.method || options.method === 'GET')) return jsonResponse([{ id: 'connection-1', organization_id: 'org-1', provider: 'mock', status: 'backfilling' }]);
    if (value.includes('/timefit_user_corporate_cards?')) return jsonResponse([{ id: 'card-1', provider_card_id: 'mock-card-corporate-4821' }]);
    if (value.includes('/timefit_user_card_sync_cursors?') && (!options.method || options.method === 'GET')) return jsonResponse([]);
    if (value.includes('/rpc/timefit_user_import_card_events')) return jsonResponse({ imported: 2, duplicates: 0, groups: 1 });
    if (value.includes('/timefit_user_card_sync_cursors?') && options.method === 'POST') return jsonResponse(null, 201);
    if ((value.includes('/timefit_user_card_sync_runs?') || value.includes('/timefit_user_card_connections?')) && options.method === 'PATCH') return jsonResponse(null);
    throw new Error(`unexpected_fetch:${url}`);
  };
  try {
    const res = responseRecorder();
    await cardSyncExecute({ method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { organizationId: 'org-1', runId: 'run-1' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.result, { imported: 2, duplicates: 0, groups: 1 });
    assert.equal(calls.some(call => call.value.includes('/rpc/timefit_user_import_card_events')), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('예약 카드 동기화 워커는 비밀키가 없는 요청을 차단한다', async () => {
  configure();
  process.env.CARD_SYNC_CRON_SECRET = 'card-cron-test';
  const res = responseRecorder();
  await cardSyncWorker({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('Google Vision 영수증 텍스트를 핵심 필드로 구조화한다', () => {
  const receipt = structuredReceipt('타임핏 식자재마트\n사업자등록번호 123-45-67890\n2026-09-10 09:30\n카드번호 ****4821\n승인번호 100001\n결제금액 120,000');
  assert.equal(receipt.merchantName, '타임핏 식자재마트');
  assert.equal(receipt.transactionDate, '2026-09-10');
  assert.equal(receipt.totalAmount, 120000);
  assert.equal(receipt.merchantBusinessNumber, '123-45-67890');
  assert.equal(receipt.approvalNumber, '100001');
  assert.equal(receipt.cardLast4, '4821');
});

test('영수증과 카드 거래의 강한 식별자를 점수화한다', () => {
  const result = matchScore(
    { totalAmount: 120000, transactionDate: '2026-09-10', approvalNumber: '100001', cardLast4: '4821' },
    { net_amount: 120000, approved_at: '2026-09-10T09:30:00+09:00', approval_number: '100001', card: { last4: '4821' } },
  );
  assert.equal(result.score, 100);
  assert.deepEqual(result.breakdown, { amount: 45, date: 25, approvalNumber: 25, cardLast4: 5 });
});

test('영수증 재분석은 동시 실행·최대 횟수·원장 중복을 차단한다', () => {
  assert.equal(receiptRetryBlocker([{ status: 'processing' }], false), 'processing');
  assert.equal(receiptRetryBlocker(Array.from({ length: 5 }, () => ({ status: 'failed' })), false), 'limit');
  assert.equal(receiptRetryBlocker([{ status: 'failed' }], true), 'already_processed');
  assert.equal(receiptRetryBlocker([{ status: 'failed' }], false), null);
});

test('영수증 촬영 품질 검사에서 저해상도와 어두운 흐림을 감지한다', () => {
  const darkPixels = new Uint8ClampedArray(40 * 40 * 4).fill(20);
  for (let index = 3; index < darkPixels.length; index += 4) darkPixels[index] = 255;
  const codes = analyzeReceiptPixels({ width: 600, height: 400, pixels: darkPixels, sampleWidth: 40, sampleHeight: 40 }).map(issue => issue.code);
  assert.deepEqual(codes, ['low_resolution','too_dark','blurred']);
});

test('지출 검토 API는 로그인하지 않은 확정 요청을 차단한다', async () => {
  configure();
  const res = responseRecorder();
  await expenseReview({ method: 'POST', headers: {}, body: { organizationId: 'org-1', matchId: 'match-1', action: 'confirm' } }, res);
  assert.equal(res.statusCode, 401);
});

test('매출·확정 지출·월 급여 초안으로 운영순익을 계산한다', () => {
  const report = buildFinanceReport({
    from: '2026-09-01', to: '2026-09-02',
    salesRows: [{ sales_date: '2026-09-01', completed_amount: 500000 }, { sales_date: '2026-09-02', completed_amount: 300000 }],
    expenses: [{ transaction_date: '2026-09-01', total_amount: 100000, status: 'confirmed' }],
    payrollDrafts: [{ id: 'payroll-1', settlement_month: '2026-09-01' }],
    payrollLines: [{ payroll_draft_id: 'payroll-1', estimated_total: 3000000 }],
  });
  assert.deepEqual({ netSales: report.totals.netSales, operatingExpenses: report.totals.operatingExpenses, laborCost: report.totals.laborCost, operatingProfit: report.totals.operatingProfit, profitMargin: report.totals.profitMargin }, { netSales: 800000, operatingExpenses: 100000, laborCost: 200000, operatingProfit: 500000, profitMargin: 62.5 });
  assert.equal(report.completeness.payrollComplete, true);
});

test('영수증이 없는 미대사 카드 사용액도 잠정 운영지출과 순익에 반영한다', () => {
  const report = buildFinanceReport({
    from: '2026-09-01', to: '2026-09-02',
    salesRows: [{ sales_date: '2026-09-01', completed_amount: 500000 }],
    expenses: [{ transaction_date: '2026-09-01', total_amount: 100000, category: '재료비' }],
    unreconciledCardTransactions: [
      { approved_at: '2026-09-01T12:00:00+09:00', net_amount: 50000 },
      { approved_at: '2026-09-02T12:00:00+09:00', net_amount: 30000 },
    ],
  });
  assert.equal(report.totals.confirmedExpenses, 100000);
  assert.equal(report.totals.provisionalCardExpenses, 80000);
  assert.equal(report.totals.operatingExpenses, 180000);
  assert.equal(report.totals.operatingProfit, 320000);
  assert.equal(report.series[0].provisionalCardExpenses, 50000);
});

test('버터빌라 손익 기준으로 구매비·카드수수료·매출연동 임대료를 계산한다', () => {
  const report = buildFinanceReport({
    from: '2026-09-01', to: '2026-09-01', cardFeeRate: 0.022, revenueRentRate: 0.15,
    salesRows: [{ sales_date: '2026-09-01', completed_amount: 1000000, completed_order_count: 40 }],
    expenses: [
      { transaction_date: '2026-09-01', total_amount: 200000, category: '주방 식자재' },
      { transaction_date: '2026-09-01', total_amount: 50000, category: '홀 음료·주류' },
      { transaction_date: '2026-09-01', total_amount: 30000, category: '소모품' },
    ],
  });
  assert.equal(report.totals.kitchenPurchases, 200000);
  assert.equal(report.totals.hallPurchases, 50000);
  assert.equal(report.totals.cardFees, 22000);
  assert.equal(report.totals.rentExpense, 150000);
  assert.equal(report.totals.averageOrderValue, 25000);
  assert.equal(report.totals.operatingProfit, 548000);
});

test('연말 보고서는 월별 순익으로 묶고 직전 동기간 증감률을 계산한다', () => {
  const current = { totals: { netSales: 120, operatingExpenses: 30, laborCost: 20, operatingProfit: 70 } };
  const previous = { totals: { netSales: 100, operatingExpenses: 20, laborCost: 20, operatingProfit: 60 } };
  assert.deepEqual(previousFinanceRange('2026-01-01', '2026-12-31', 'annual'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(previousFinanceRange('2026-03-01', '2026-03-31', 'monthly'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(compareFinanceReports(current, previous).netSales, { current: 120, previous: 100, changeRate: 20 });
  const grouped = groupFinanceSeries([
    { date: '2026-01-01', sales: 10, operatingExpenses: 2, laborCost: 3, operatingProfit: 5 },
    { date: '2026-01-02', sales: 20, operatingExpenses: 4, laborCost: 6, operatingProfit: 10 },
  ], 'annual');
  assert.deepEqual(grouped, [{ date: '2026-01', sales: 30, operatingExpenses: 6, laborCost: 9, operatingProfit: 15 }]);
});

test('급여 초안은 실제 출근일과 시급제 근무시간 비중으로 일별 배분한다', () => {
  const labor = buildDailyLaborMap({
    payrollDrafts: [{ id: 'draft-1', settlement_month: '2026-09-01' }],
    payrollLines: [{ payroll_draft_id: 'draft-1', staff_id: 'staff-1', pay_type: 'hourly', estimated_total: 300000 }],
    attendanceRecords: [
      { staff_id: 'staff-1', work_date: '2026-09-01', checked_in_at: '2026-09-01T00:00:00Z', checked_out_at: '2026-09-01T04:00:00Z' },
      { staff_id: 'staff-1', work_date: '2026-09-02', checked_in_at: '2026-09-02T00:00:00Z', checked_out_at: '2026-09-02T08:00:00Z' },
    ],
  });
  assert.equal(labor.get('2026-09-01'), 100000);
  assert.equal(labor.get('2026-09-02'), 200000);
  assert.equal(labor.get('2026-09-03'), 0);
  assert.equal([...labor.values()].reduce((sum, amount) => sum + amount, 0), 300000);
});

test('결산 준비 상태는 증빙률·카드 대사·연결 상태를 모두 검사한다', () => {
  const result = buildCloseoutCompleteness({
    expenses: [
      { sources: [{ source_type: 'receipt' }, { source_type: 'card_transaction_group' }] },
      { sources: [{ source_type: 'manual' }] },
    ],
    unresolvedReceipts: 1,
    unresolvedCardTransactions: 2,
    unhealthyConnections: 1,
  });
  assert.equal(result.evidenceRate, 50);
  assert.equal(result.evidenceComplete, false);
  assert.equal(result.cardReconciliationComplete, false);
  assert.equal(result.cardSyncHealthy, false);
  assert.equal(buildCloseoutCompleteness({ expenses: [] }).evidenceRate, 100);
});

test('결산 CSV에는 증빙·카드 상태와 확정 감사정보가 포함된다', () => {
  const rows = financeReportCsvRows({ periodType: 'monthly', report: {
    from: '2026-09-01', to: '2026-09-30', totals: { netSales: 10, operatingExpenses: 2, laborCost: 3, operatingProfit: 5 }, series: [],
    completeness: { evidenceRate: 95, confirmedExpenses: 20, evidencedExpenses: 19, unresolvedCardTransactions: 1, cardSyncHealthy: true, laborBasis: 'attendance_weighted_payroll_draft' },
    audit: { status: 'closed', version: 2, closedByName: '관리자', closedAt: '2026-10-01T01:00:00Z', sourceCutoffAt: '2026-10-01T00:00:00Z' },
  } });
  assert.deepEqual(rows[2].slice(0, 2), ['상태', '확정 · 버전 2']);
  assert.deepEqual(rows[3].slice(0, 2), ['확정자', '관리자']);
  assert.equal(rows[6][1], '95%');
  assert.equal(rows[6][5], 1);
});

test('지출 원장 합계에서 제외 건을 빼고 미증빙 건을 집계한다', () => {
  const summary = summarizeExpenses([
    { total_amount: 100000, status: 'confirmed', sources: [{ source_type: 'receipt' }] },
    { total_amount: 50000, status: 'review_required', sources: [{ source_type: 'card_transaction_group' }] },
    { total_amount: 30000, status: 'excluded', sources: [] },
  ]);
  assert.deepEqual(summary, { count: 3, totalAmount: 150000, confirmedAmount: 100000, reviewCount: 1, missingEvidenceCount: 2 });
});

test('영수증 없는 카드 승인은 조회 가능한 임시 지출로 변환한다', () => {
  const item = provisionalCardExpense({ id: 'transaction-1', merchant_name: '식자재마트', net_amount: 48000, approved_at: '2026-09-14T03:00:00Z', card: { holder: { display_name: '김관리' } } });
  assert.equal(item.id, 'card:transaction-1');
  assert.equal(item.status, 'review_required');
  assert.equal(item.receipt_missing, true);
  assert.equal(item.total_amount, 48000);
  assert.equal(item.sources[0].source_type, 'card_transaction_group');
});

test('지출 원장 API는 로그인하지 않은 요청을 차단한다', async () => {
  configure(); const res = responseRecorder();
  await expenses({ method: 'GET', headers: {}, query: { organizationId: 'org-1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('직접 지출은 총액과 공급가액·부가세 합계를 검증한다', () => {
  assert.equal(validateManualExpense({ transactionDate: '2026-09-10', totalAmount: 11000, supplyAmount: 10000, vatAmount: 1000 }).error, undefined);
  assert.match(validateManualExpense({ transactionDate: '2026-09-10', totalAmount: 12000, supplyAmount: 10000, vatAmount: 1000 }).error, /일치/);
  assert.match(validateManualExpense({ transactionDate: '', totalAmount: 0 }).error, /거래일/);
});

test('지출 상세 API는 로그인하지 않은 원천자료 조회를 차단한다', async () => {
  configure(); const res = responseRecorder();
  await expenseDetail({ method: 'GET', headers: {}, query: { organizationId: 'org-1', expenseId: 'expense-1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('지출 원장 CSV는 한글 BOM과 증빙 여부 및 따옴표 이스케이프를 포함한다', () => {
  const csv = expenseLedgerCsv([{ ledger_entry_id: 'ledger-1', transaction_date: '2026-09-10', merchant_name: '마켓 "본점"', total_amount: 12000, status: 'confirmed', sources: [{ source_type: 'receipt' }] }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /마켓 ""본점""/);
  assert.match(csv, /"있음"/);
  assert.match(csv, /ledger-1/);
});

test('하이픈 카드 응답을 전체 번호 없이 공통 카드 모델로 정규화한다', () => {
  const cards = normalizeHyphenCards({ data: { list: [{ cardId: 'provider-card-1', cardCompanyName: '테스트카드', cardName: '운영카드', cardNoMask: '1234-****-****-4821' }] } });
  assert.deepEqual(cards[0], { providerAssetId: 'provider-card-1', issuer: '테스트카드', displayName: '운영카드', last4: '4821', status: 'active', sourceIndex: 0 });
  assert.equal(JSON.stringify(cards).includes('1234-'), false);
});

test('하이픈 승인·부분취소 응답을 불변 이벤트로 정규화한다', () => {
  const events = normalizeHyphenEvents({ list: [{ transactionId: 'tx-1', transactionType: '부분취소', approvalDateTime: '2026-09-10T10:00:00+09:00', approvalAmount: '20,000', approvalNumber: '1001', merchantName: '식자재마트' }] });
  assert.equal(events[0].eventType, 'partial_cancellation'); assert.equal(events[0].amount, 20000); assert.equal(events[0].providerEventId, 'tx-1');
});

test('카드 증분 동기화는 마지막 성공일에서 7일을 겹쳐 재대조한다', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  assert.deepEqual(cardSyncWindow({ mode: 'incremental', succeededThrough: '2026-09-09T00:00:00Z', now }), { from: '2026-09-02T00:00:00.000Z', to: '2026-09-10T00:00:00.000Z' });
  assert.equal(cardSyncWindow({ mode: 'backfill', now }).from, '2026-06-12T00:00:00.000Z');
});

test('card sync failures use category-specific backoff and stop on authentication errors', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  assert.equal(cardSyncErrorCategory(new Error('HTTP 401 unauthorized')), 'authentication');
  assert.equal(cardSyncErrorCategory(new Error('503 provider maintenance')), 'provider_maintenance');
  assert.deepEqual(cardRetryPlan({ category: 'authentication', now }), { status: 'reauth_required', nextSyncAt: null });
  assert.equal(cardRetryPlan({ category: 'network', failureCount: 3, now }).nextSyncAt, '2026-09-10T01:00:00.000Z');
  assert.equal(cardRetryPlan({ category: 'rate_limit', now }).nextSyncAt, '2026-09-10T04:00:00.000Z');
});

test('결산 확정 API는 로그인하지 않은 요청을 차단한다', async () => {
  configure(); const res = responseRecorder();
  await closeouts({ method: 'POST', headers: {}, body: { organizationId: 'org-1', closeoutId: 'closeout-1', action: 'close' } }, res);
  assert.equal(res.statusCode, 401);
});

test('LLM 영수증 JSON을 검증하고 규칙 기반 누락값을 병합한다', () => {
  const ai = validateReceiptExtraction({ merchantName: '식자재마트', transactionDate: '2026-09-10', transactionTime: '09:30', totalAmount: 110000, supplyAmount: 100000, vatAmount: 10000, merchantBusinessNumber: null, approvalNumber: '100001', cardLast4: '4821', category: '재료비', confidence: 0.94 });
  const merged = mergeReceiptExtractions({ merchantName: null, transactionDate: null, totalAmount: 110000, merchantBusinessNumber: '123-45-67890', approvalNumber: null, cardLast4: null }, { data: ai });
  assert.equal(merged.merchantBusinessNumber, '123-45-67890');
  assert.equal(merged.category, '재료비');
  assert.equal(merged.supplyAmount + merged.vatAmount, merged.totalAmount);
  assert.equal(merged.extractionProvider, 'openai_structured_outputs');
});

test('공급가액과 부가세가 합계와 다르면 세부 금액을 폐기한다', () => {
  const result = validateReceiptExtraction({ merchantName: null, transactionDate: null, transactionTime: null, totalAmount: 100000, supplyAmount: 80000, vatAmount: 10000, merchantBusinessNumber: null, approvalNumber: null, cardLast4: null, category: null, confidence: 0.9 });
  assert.equal(result.supplyAmount, null); assert.equal(result.vatAmount, null); assert.equal(result.confidence, 0.6);
});

test('파일이 달라도 같은 영수증 핵심값은 동일한 지문을 만든다', () => {
  const first = receiptFingerprint({ transactionDate: '2026-09-10', totalAmount: 120000, merchantBusinessNumber: '123-45-67890', approvalNumber: '100001', cardLast4: '4821' });
  const second = receiptFingerprint({ transactionDate: '2026-09-10', totalAmount: 120000, merchantBusinessNumber: '1234567890', approvalNumber: '100001', cardLast4: '4821' });
  assert.equal(first, second); assert.equal(first.length, 64);
});

test('오래된 미증빙 거래와 OCR 실패를 긴급 예외로 우선 정렬한다', () => {
  const result = buildExpenseExceptions({
    now: new Date('2026-09-10T12:00:00Z'),
    transactions: [{ id: 'tx-1', approved_at: '2026-09-01T00:00:00Z', merchant_name: '식자재마트', net_amount: 120000, card: { nickname: '운영카드', last4: '4821' } }],
    documents: [{ id: 'doc-1', title: '영수증', processing_status: 'failed', processing_error: 'vision_timeout', created_at: '2026-09-10T01:00:00Z' }],
  });
  assert.equal(result.summary.critical, 2);
  assert.equal(result.items[0].severity, 'critical');
  assert.equal(result.summary.missingReceipts, 1);
});

test('영수증 알림은 설정 주기에 맞춰 한 단계씩 생성하고 최대 횟수를 지킨다', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  assert.equal(dueReminderNumber({ approvedAt: '2026-09-08T00:00:00Z', now }), null);
  assert.equal(dueReminderNumber({ approvedAt: '2026-09-07T00:00:00Z', now }), 1);
  assert.equal(dueReminderNumber({ approvedAt: '2026-09-03T00:00:00Z', now, sentCount: 1 }), 2);
  assert.equal(dueReminderNumber({ approvedAt: '2026-08-01T00:00:00Z', now, sentCount: 3 }), null);
});

test('영수증 알림 워커는 비밀키가 없는 요청을 차단한다', async () => {
  configure(); process.env.EXPENSE_REMINDER_CRON_SECRET = 'receipt-cron-test';
  const res = responseRecorder();
  await expenseReminderWorker({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 401); assert.equal(res.body.error, 'Unauthorized');
});

test('영수증 알림 수동 실행은 로그인하지 않은 요청을 차단한다', async () => {
  configure(); const res = responseRecorder();
  await expenseReminderWorker({ method: 'POST', headers: {}, body: { organizationId: 'org-1' } }, res);
  assert.equal(res.statusCode, 401); assert.equal(res.body.error, '관리자 인증이 필요합니다.');
});

test('예외 업무함에 미제출 알림 횟수를 함께 표시한다', () => {
  const result = buildExpenseExceptions({
    now: new Date('2026-09-10T00:00:00Z'),
    transactions: [{ id: 'tx-1', approved_at: '2026-09-05T00:00:00Z', merchant_name: '마트', net_amount: 10000, card: { last4: '4821' } }],
    reminders: [{ transaction_group_id: 'tx-1', reminder_number: 1 }, { transaction_group_id: 'tx-1', reminder_number: 2 }],
  });
  assert.equal(result.items[0].reminderCount, 2);
  assert.match(result.items[0].description, /알림 2회/);
});

test('사업자번호 분류 규칙을 상호 규칙보다 우선 적용한다', () => {
  const rule = matchingClassificationRule(
    { merchantBusinessNumber: '123-45-67890', merchantName: '식자재마트' },
    [
      { id: 'name-rule', match_type: 'merchant_name', match_value: '식자재마트', category: '기타', priority: 200, is_active: true },
      { id: 'business-rule', match_type: 'merchant_business_number', match_value: '1234567890', category: '재료비', priority: 100, is_active: true },
    ],
  );
  assert.equal(rule.id, 'business-rule'); assert.equal(rule.category, '재료비');
});

test('일괄 확정은 영수증별 95점 이상 최상위 후보만 허용한다', () => {
  const matches = eligibleBulkMatches([
    { id: 'low', document_id: 'doc-1', expense_id: 'expense-1', transaction_group_id: 'tx-1', status: 'suggested', score: 90 },
    { id: 'best', document_id: 'doc-1', expense_id: 'expense-1', transaction_group_id: 'tx-2', status: 'suggested', score: 98 },
    { id: 'other', document_id: 'doc-2', expense_id: 'expense-2', transaction_group_id: 'tx-3', status: 'suggested', score: 95 },
  ]);
  assert.deepEqual(matches.map(item => item.id).sort(), ['best','other']);
});
