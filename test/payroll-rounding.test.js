import test from 'node:test';
import assert from 'node:assert/strict';
import { roundPayableMinutes } from '../src/payrollRounding.js';

test('버터빌라 30분 올림: 20분 근무를 30분 급여시간으로 계산한다', () => {
  const policy = { payroll_rounding_enabled: true, attendance_rounding_minutes: 30, attendance_rounding_mode: 'ceil' };
  assert.equal(roundPayableMinutes(20, policy), 30);
  assert.equal(roundPayableMinutes(30, policy), 30);
  assert.equal(roundPayableMinutes(31, policy), 60);
  assert.equal(12000 * roundPayableMinutes(20, policy) / 60, 6000);
});

test('반올림 비활성화된 다른 사업장의 원시 시간 규칙은 유지한다', () => {
  assert.equal(roundPayableMinutes(20, { payroll_rounding_enabled: false }), 20);
});
