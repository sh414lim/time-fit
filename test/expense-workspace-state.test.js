import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expenseReviewStateKey,
  expenseWorkspaceStateKey,
  normalizeExpenseReviewState,
  normalizeExpenseWorkspaceState,
  readExpenseUiState,
  writeExpenseUiState,
} from '../src/features/finance/expenseWorkspaceState.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('지출 증빙 하위 탭은 계정과 사업장별로 복원된다', () => {
  const storage = memoryStorage();
  const key = expenseWorkspaceStateKey('manager-1', 'store-1');
  writeExpenseUiState(key, { section: 'evidence' }, normalizeExpenseWorkspaceState, storage);
  assert.deepEqual(readExpenseUiState(key, normalizeExpenseWorkspaceState, storage), { section: 'evidence' });
  assert.notEqual(key, expenseWorkspaceStateKey('manager-2', 'store-1'));
});

test('증빙 검토 필터와 펼친 영수증을 복원하고 잘못된 값은 초기화한다', () => {
  const storage = memoryStorage();
  const key = expenseReviewStateKey('manager-1', 'store-1');
  writeExpenseUiState(key, { status: 'manager_review', costCenterId: 'kitchen', expandedId: 'receipt-1' }, normalizeExpenseReviewState, storage);
  assert.deepEqual(readExpenseUiState(key, normalizeExpenseReviewState, storage), {
    status: 'manager_review',
    costCenterId: 'kitchen',
    expandedId: 'receipt-1',
  });
  storage.setItem(key, JSON.stringify({ status: 'invalid', costCenterId: null, expandedId: null }));
  assert.deepEqual(readExpenseUiState(key, normalizeExpenseReviewState, storage), {
    status: 'attention',
    costCenterId: '',
    expandedId: '',
  });
});
