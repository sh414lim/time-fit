import test from 'node:test';
import assert from 'node:assert/strict';
import { roundPayableMinutes } from '../src/payrollRounding.js';

test('기존 30분 올림 설정을 쓰는 사업장도 그대로 계산한다', () => {
  const policy = { payroll_rounding_enabled: true, attendance_rounding_minutes: 30, attendance_rounding_mode: 'ceil' };
  assert.equal(roundPayableMinutes(20, policy), 30);
  assert.equal(roundPayableMinutes(30, policy), 30);
  assert.equal(roundPayableMinutes(31, policy), 60);
  assert.equal(12000 * roundPayableMinutes(20, policy) / 60, 6000);
});

test('버터빌라 10분 반올림: 잔여 5분 미만은 버리고 5분부터 올린다', () => {
  const policy = { payroll_rounding_enabled: true, attendance_rounding_minutes: 10, attendance_rounding_mode: 'nearest' };
  assert.equal(roundPayableMinutes(1, policy), 0);
  assert.equal(roundPayableMinutes(4 + 59 / 60, policy), 0);
  assert.equal(roundPayableMinutes(5, policy), 10);
  assert.equal(roundPayableMinutes(20, policy), 20);
  assert.equal(roundPayableMinutes(21, policy), 20);
  assert.equal(roundPayableMinutes(24 + 59 / 60, policy), 20);
  assert.equal(roundPayableMinutes(25, policy), 30);
  assert.equal(roundPayableMinutes(57, policy), 60);
  assert.equal(12000 * roundPayableMinutes(20, policy) / 60, 4000);
  assert.equal(12000 * roundPayableMinutes(57, policy) / 60, 12000);
});

test('반올림 비활성화된 다른 사업장의 원시 시간 규칙은 유지한다', () => {
  assert.equal(roundPayableMinutes(20, { payroll_rounding_enabled: false }), 20);
});
