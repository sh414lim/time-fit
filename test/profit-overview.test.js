import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGranterProfitFact, granterRowToFinanceFact } from '../server/api/_profit-store.js';
import { buildProfitOverview, profitSnapshotKey } from '../server/api/_profit-overview.js';

test('Granter 지출을 손익 버킷으로 안전하게 분류한다', () => {
  assert.deepEqual(classifyGranterProfitFact({ direction: 'out', isIncluded: true, isClassified: true, categoryId: 1, category: '식자재비' }), { profitBucket: 'purchase_cost', includeInProfit: true, provisional: false });
  assert.deepEqual(classifyGranterProfitFact({ direction: 'out', isIncluded: true, isClassified: true, categoryId: 2, category: '급여' }), { profitBucket: 'labor', includeInProfit: false, provisional: false });
  assert.deepEqual(classifyGranterProfitFact({ direction: 'out', isIncluded: true, isClassified: false }), { profitBucket: 'unclassified', includeInProfit: true, provisional: true });
  assert.equal(classifyGranterProfitFact({ direction: 'in', isIncluded: true }).includeInProfit, false);
});

test('정규화 사실 데이터는 원천 식별자와 분류를 보존한다', () => {
  const fact = granterRowToFinanceFact({ organizationId: 'org-1', runId: 'run-1', revision: '2026-10-01', row: { id: 'EXPENSE_TICKET:1', ticketType: 'EXPENSE_TICKET', date: '2026-11-01', direction: 'out', amount: 12500, isIncluded: true, isClassified: true, categoryId: 1, category: '식자재비', tags: [] } });
  assert.equal(fact.source_id, 'EXPENSE_TICKET:1');
  assert.equal(fact.amount, 12500);
  assert.equal(fact.profit_bucket, 'purchase_cost');
  assert.equal(fact.include_in_profit, true);
});

test('사업장 계정과목 매핑은 기본 자동 분류보다 우선한다', () => {
  const fact = granterRowToFinanceFact({
    organizationId: 'org-1', runId: 'run-1', revision: '2026-10-01',
    row: { id: 'EXPENSE_TICKET:2', ticketType: 'EXPENSE_TICKET', date: '2026-11-01', direction: 'out', amount: 30000, isIncluded: true, isClassified: true, categoryId: 9, category: '기타', tags: [] },
    mapping: { profit_bucket: 'asset', include_in_profit: false },
  });
  assert.equal(fact.profit_bucket, 'asset');
  assert.equal(fact.include_in_profit, false);
});

test('매출·구매비·인건비·운영비로 영업이익을 계산한다', () => {
  const result = buildProfitOverview({
    from: '2026-11-01', to: '2026-11-01',
    salesRows: [{ sales_date: '2026-11-01', completed_amount: 1000000, finalization_status: 'captured' }],
    facts: [
      { occurred_on: '2026-11-01', direction: 'out', amount: 200000, profit_bucket: 'purchase_cost', include_in_profit: true, source_category_name: '식자재비' },
      { occurred_on: '2026-11-01', direction: 'out', amount: 100000, profit_bucket: 'opex', include_in_profit: true, source_category_name: '소모품비' },
    ],
    payrollDrafts: [{ id: 'draft-1', settlement_month: '2026-11-01', status: 'saved' }],
    payrollLines: [{ payroll_draft_id: 'draft-1', staff_id: 'staff-1', pay_type: 'monthly', estimated_total: 300000 }],
    attendanceRecords: [{ staff_id: 'staff-1', work_date: '2026-11-01', checked_in_at: '2026-11-01T01:00:00Z', checked_out_at: '2026-11-01T10:00:00Z' }],
    latestRun: { id: 'run-1', status: 'succeeded', range_from: '2026-11-01', range_to: '2026-11-01', finished_at: '2026-11-01T12:00:00Z' },
    salesConnection: { id: 'connection-1', connection_status: 'connected' },
    today: '2026-11-02',
  });
  assert.equal(result.totals.netSales, 1000000);
  assert.equal(result.totals.purchaseCost, 200000);
  assert.equal(result.totals.laborCost, 300000);
  assert.equal(result.totals.operatingExpenses, 100000);
  assert.equal(result.totals.operatingProfit, 400000);
  assert.equal(result.status, 'actual');
  assert.equal(profitSnapshotKey({ from: '2026-11-01', to: '2026-11-30' }), 'profit-v1:day:2026-11-01:2026-11-30');
});

test('미분류 금액이 있으면 손익은 잠정 상태다', () => {
  const result = buildProfitOverview({
    from: '2026-11-01', to: '2026-11-01', salesRows: [{ sales_date: '2026-11-01', completed_amount: 0, finalization_status: 'captured' }],
    facts: [{ occurred_on: '2026-11-01', direction: 'out', amount: 5000, profit_bucket: 'unclassified', include_in_profit: true }],
    payrollDrafts: [{ id: 'draft-1', settlement_month: '2026-11-01' }], payrollLines: [], attendanceRecords: [],
    latestRun: { id: 'run-1', status: 'succeeded', range_from: '2026-11-01', range_to: '2026-11-01' }, salesConnection: { id: 'connection-1' }, today: '2026-11-02',
  });
  assert.equal(result.status, 'provisional');
  assert.equal(result.completeness.unclassifiedCount, 1);
});

test('손익 저장 테이블은 RLS와 서버 전용 권한을 사용한다', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261120033934_profit_overview_hybrid_store.sql', import.meta.url), 'utf8');
  assert.match(sql, /timefit_user_finance_facts/);
  assert.match(sql, /timefit_user_profit_snapshots/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.timefit_user_finance_facts from anon, authenticated/i);
  assert.match(sql, /to service_role/i);
});

test('Granter 워크플로는 원천 행 전체를 사실 테이블에 저장한다', async () => {
  const source = await readFile(new URL('../workflows/granter-finance-sync.js', import.meta.url), 'utf8');
  assert.match(source, /persistGranterFinanceFacts/);
  assert.match(source, /rebuildProfitSnapshot/);
});

test('POS와 Granter 원천은 화면 진입이 아닌 3시간 배치로 갱신한다', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const schedules = Object.fromEntries(config.crons.map(item => [item.path, item.schedule]));
  assert.equal(schedules['/api/sync-sales'], '0 */3 * * *');
  assert.equal(schedules['/api/granter-profit-sync-worker'], '10 */3 * * *');
});
