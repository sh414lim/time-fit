import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledPayroll } from '../src/payrollComparison.js';

const schedule = { staff_id: 'a', work_date: '2026-09-05', starts_at: '09:00', ends_at: '18:00', break_minutes: 60, break_paid: false };

test('무급 휴게를 뺀 스케줄 기준 시급 예상액을 계산한다', () => {
  assert.deepEqual(scheduledPayroll({ staffId: 'a', month: '2026-09', schedules: [schedule], policy: { payroll_rounding_enabled: false }, payType: 'hourly', rate: 12000 }), { scheduledMinutes: 480, scheduledDays: 1, scheduledPay: 96000 });
});

test('유급 휴게와 휴무는 각각 포함·제외한다', () => {
  const result = scheduledPayroll({ staffId: 'a', month: '2026-09', schedules: [{ ...schedule, break_paid: true }, { ...schedule, work_date: '2026-09-06', is_day_off: true }], policy: { payroll_rounding_enabled: false }, payType: 'hourly', rate: 12000 });
  assert.equal(result.scheduledMinutes, 540);
  assert.equal(result.scheduledDays, 1);
  assert.equal(result.scheduledPay, 108000);
});

test('일급과 고정 월급은 각 계약 형태에 맞는 기준을 사용한다', () => {
  assert.equal(scheduledPayroll({ staffId: 'a', month: '2026-09', schedules: [schedule], payType: 'daily', rate: 100000 }).scheduledPay, 100000);
  assert.equal(scheduledPayroll({ staffId: 'a', month: '2026-09', schedules: [], payType: 'monthly', rate: 2500000 }).scheduledPay, 2500000);
});
