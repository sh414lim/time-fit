// Temporary store rule lives in organization settings, not a global payroll default.
export function payrollBreakMinutes({ schedule, policy = {}, grossMinutes }) {
  const fullTimeOverride = schedule && !schedule.is_day_off
    && String(schedule.shift_name || '').includes('풀타임')
    && Number.isFinite(Number(policy.temporary_fulltime_break_minutes))
    && policy.temporary_fulltime_break_minutes !== null
    ? Number(policy.temporary_fulltime_break_minutes) : null;
  const configured = fullTimeOverride ?? (policy.payroll_deduct_break_enabled === false
    ? 0 : Number(schedule?.break_minutes ?? policy.standard_break_minutes ?? 0));
  return Math.min(Math.max(0, Number(grossMinutes) || 0), Math.max(0, configured));
}
