import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { payableAttendanceMinutes } from '../src/payrollAttendance.js';
import { scheduledPayroll } from '../src/payrollComparison.js';

const butterVillaPolicy = {
  payroll_include_after_scheduled_end: true,
  payroll_rounding_enabled: true,
  attendance_rounding_minutes: 30,
  attendance_rounding_mode: 'nearest',
  payroll_deduct_break_enabled: true,
};
const schedule = {
  staff_id: 'staff-a', work_date: '2026-11-03', starts_at: '09:00:00',
  ends_at: '18:00:00', break_minutes: 0, break_paid: false, is_day_off: false,
};
const record = (start, end) => ({
  staff_id: 'staff-a', work_date: '2026-11-03',
  checked_in_at: `2026-11-03T${start}+09:00`,
  checked_out_at: end ? `2026-11-03T${end}+09:00` : null,
});
const calculate = (attendance, shift = schedule, policy = butterVillaPolicy) =>
  payableAttendanceMinutes(attendance, shift ? [shift] : [], policy);

for (const [end, expectedMinutes] of [
  ['09:00:00', 0], ['09:14:59.999', 0], ['09:15:00', 30],
  ['09:29:59.999', 30], ['09:30:00', 30], ['09:44:59.999', 30],
  ['09:45:00', 60], ['10:14:59.999', 60], ['10:15:00', 90],
]) {
  test(`Butter Villa rounds 09:00 through ${end} to ${expectedMinutes} payable minutes`, () => {
    assert.equal(calculate(record('09:00:00', end)).payableMinutes, expectedMinutes);
  });
}

test('early check-in is excluded but actual checkout after scheduled end is included', () => {
  const result = calculate(record('08:40:00', '18:20:00'), { ...schedule, break_minutes: 60 });
  assert.equal(result.grossMinutes, 560);
  assert.equal(result.breakMinutes, 60);
  assert.equal(result.payableMinutes, 510);
  assert.equal(result.payableMinutes / 60 * 12000, 102000);
});

test('late check-in starts at actual check-in, including the exact 15-minute boundary', () => {
  assert.equal(calculate(record('09:10:01', '09:25:00')).payableMinutes, 0);
  assert.equal(calculate(record('09:10:00', '09:25:00')).payableMinutes, 30);
});

test('a checkout before scheduled start cannot create payable time', () => {
  assert.equal(calculate(record('08:00:00', '08:59:59')).payableMinutes, 0);
});

test('scheduled start still applies when an opted-in shift has no scheduled end', () => {
  assert.equal(calculate(record('08:00:00', '09:14:59'), { ...schedule, ends_at: null }).payableMinutes, 0);
});

test('missing check-in or checkout is not paid', () => {
  assert.equal(calculate(record('09:00:00', null)).payableMinutes, 0);
  assert.equal(calculate({ ...record('09:00:00', '18:00:00'), checked_in_at: null }).payableMinutes, 0);
});

test('night shifts include actual next-day checkout without truncation', () => {
  const overnight = { ...schedule, starts_at: '22:00:00', ends_at: '06:00:00', break_minutes: 60 };
  const result = calculate({ ...record('21:45:00', '23:00:00'), checked_out_at: '2026-11-04T06:15:00+09:00' }, overnight);
  assert.equal(result.grossMinutes, 495);
  assert.equal(result.payableMinutes, 450);
});

test('existing fixed two-hour unpaid break is deducted before rounding', () => {
  const policy = { ...butterVillaPolicy, temporary_fulltime_break_minutes: 120, payroll_deduct_break_enabled: false };
  const result = calculate(record('08:30:00', '18:15:00'), { ...schedule, shift_name: '일반 근무', break_minutes: 30 }, policy);
  assert.equal(result.grossMinutes, 555);
  assert.equal(result.breakMinutes, 120);
  assert.equal(result.payableMinutes, 450);
  assert.equal(calculate(record('09:00:00', '10:00:00'), { ...schedule, shift_name: '풀타임' }, policy).payableMinutes, 0);
});

test('unpaid break is subtracted before rounding, not after it', () => {
  const result = calculate(record('09:00:00', '09:45:00'), { ...schedule, break_minutes: 20 });
  assert.equal(result.payableMinutes, 30);
});

test('paid break remains paid', () => {
  const result = calculate(record('09:00:00', '10:15:00'), { ...schedule, break_minutes: 60, break_paid: true });
  assert.equal(result.breakMinutes, 0);
  assert.equal(result.payableMinutes, 90);
});

test('each attendance day is rounded before summing, not after monthly summation', () => {
  const dailyResults = [record('09:00:00', '09:14:00'), record('09:00:00', '09:14:00')];
  assert.equal(dailyResults.reduce((sum, item) => sum + calculate(item).payableMinutes, 0), 0);
});

test('no matching schedule retains actual attendance fallback', () => {
  assert.equal(calculate(record('08:00:00', '08:15:00'), null).payableMinutes, 30);
  assert.equal(calculate(record('08:00:00', '08:15:00'), { ...schedule, staff_id: 'other' }).payableMinutes, 30);
});

test('other workplaces keep the scheduled-end cap and their existing rounding mode', () => {
  const existingPolicy = { payroll_rounding_enabled: true, attendance_rounding_minutes: 10, attendance_rounding_mode: 'floor' };
  const result = calculate(record('08:40:00', '18:20:00'), { ...schedule, break_minutes: 60 }, existingPolicy);
  assert.equal(result.grossMinutes, 540);
  assert.equal(result.payableMinutes, 480);
  assert.equal(calculate(record('09:00:00', '09:21:00'), schedule, existingPolicy).payableMinutes, 20);
  assert.equal(calculate(record('09:00:00', '09:21:00'), schedule, {}).payableMinutes, 30);
  assert.equal(calculate(record('09:00:00', '09:21:00'), schedule, { payroll_rounding_enabled: false }).payableMinutes, 21);
});

test('other workplace full-schedule requirement and overnight cap remain unchanged', () => {
  assert.equal(calculate(record('08:00:00', '09:00:00'), { ...schedule, ends_at: null }, {}).payableMinutes, 60);
  const overnight = { ...schedule, starts_at: '22:00:00', ends_at: '06:00:00' };
  const result = calculate({ ...record('21:30:00', '23:00:00'), checked_out_at: '2026-11-04T07:00:00+09:00' }, overnight, {});
  assert.equal(result.payableMinutes, 480);
});

test('scheduled comparison still uses schedule duration while actual payroll includes extra time', () => {
  const planned = scheduledPayroll({ staffId: 'staff-a', month: '2026-11', schedules: [schedule], policy: butterVillaPolicy, payType: 'hourly', rate: 12000 });
  assert.equal(planned.scheduledMinutes, 540);
  assert.equal(calculate(record('08:00:00', '18:15:00')).payableMinutes, 570);
});

test('policy migration targets only Butter Villa and leaves contracts and breaks untouched', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261103000100_buttervilla_half_hour_actual_checkout_payroll.sql', import.meta.url), 'utf8');
  assert.match(sql, /payroll_include_after_scheduled_end boolean not null default false/);
  assert.match(sql, /where trim\(name\) = '버터빌라 강릉'/);
  assert.match(sql, /select id, name, true, true, 30, 'nearest'/);
  assert.doesNotMatch(sql, /timefit_user_payroll_contracts|temporary_fulltime_break_minutes|set break_minutes/i);
});
