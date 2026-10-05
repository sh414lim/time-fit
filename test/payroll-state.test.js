import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollMonthStorageKey, readPayrollMonth, writePayrollMonth } from '../src/lib/payrollState.js';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('급여 정산 월은 계정과 사업장별로 복원된다', () => {
  const storage = memoryStorage();
  writePayrollMonth(storage, 'owner', 'store-a', '2026-09');
  assert.equal(readPayrollMonth(storage, 'owner', 'store-a', '2026-10'), '2026-09');
  assert.equal(readPayrollMonth(storage, 'owner', 'store-b', '2026-10'), '2026-10');
  assert.equal(payrollMonthStorageKey('owner', 'store-a'), 'timefit:payroll-month:owner:store-a');
});

test('잘못된 정산 월은 현재 월 기본값으로 복구한다', () => {
  const storage = memoryStorage();
  storage.setItem(payrollMonthStorageKey('owner', 'store'), 'not-a-month');
  assert.equal(readPayrollMonth(storage, 'owner', 'store', '2026-10'), '2026-10');
});
