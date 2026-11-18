import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinanceSeries, monthRange, normalizeFinanceHubData, summarizeFinanceRows } from '../src/features/finance/financeHubModel.js';

test('재무 통합은 카드와 연결된 원장 지출을 중복 집계하지 않는다', () => {
  const model = normalizeFinanceHubData({
    expenses: [
      { id: 'expense-1', transaction_date: '2026-11-10', total_amount: 12000, merchant_name: '식자재상', category: '재료비', status: 'confirmed', sources: [{ source_type: 'card_transaction_group', source_id: 'card-group-1' }, { source_type: 'receipt', source_id: 'receipt-1' }] },
      { id: 'expense-2', transaction_date: '2026-11-11', total_amount: 5000, merchant_name: '현금 구매', category: '소모품비', status: 'confirmed', sources: [{ source_type: 'manual', source_id: 'manual-1' }] },
    ],
    cardTransactions: [{ id: 'card-group-1', approved_at: '2026-11-10T10:00:00+09:00', net_amount: 12000, merchant_name: '식자재상', status: 'acquired', card: { nickname: '운영카드', last4: '1234' } }],
    documents: [{ id: 'receipt-1', review_status: 'approved' }],
  });
  assert.equal(model.rows.length, 2);
  assert.equal(summarizeFinanceRows(model.rows).totalExpense, 17000);
  assert.equal(model.rows.find(row => row.type === 'card').evidence, 'complete');
});

test('통장 입금과 출금을 분리하고 일별 흐름을 만든다', () => {
  const model = normalizeFinanceHubData({ bankTransactions: [
    { id: 'bank-1', occurred_at: '2026-11-01T10:00:00+09:00', direction: 'deposit', amount: 30000, description: '매출 입금' },
    { id: 'bank-2', occurred_at: '2026-11-01T11:00:00+09:00', direction: 'withdrawal', amount: 10000, description: '임차료' },
  ] });
  const summary = summarizeFinanceRows(model.rows);
  const series = buildFinanceSeries(model.rows);
  assert.equal(summary.deposits, 30000);
  assert.equal(summary.bankWithdrawal, 10000);
  assert.deepEqual(series.daily[0], { date: '2026-11-01', expense: 10000, deposit: 30000, count: 2 });
});

test('월 조회 범위는 해당 월 말일까지 계산한다', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
});
