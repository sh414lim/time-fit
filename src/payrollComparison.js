import { payrollBreakMinutes } from './payrollBreakPolicy.js';

const minutesOf = value => {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
};

export function scheduledPayroll({ staffId, month, schedules = [], policy = {}, payType, rate }) {
  const shifts = schedules.filter(schedule => schedule.staff_id === staffId
    && String(schedule.work_date || '').startsWith(month)
    && !schedule.is_day_off && schedule.starts_at && schedule.ends_at);
  const scheduledMinutes = shifts.reduce((sum, schedule) => {
    const start = minutesOf(schedule.starts_at);
    let end = minutesOf(schedule.ends_at);
    if (end <= start) end += 1440;
    const grossMinutes = end - start;
    const breakMinutes = schedule.break_paid === true ? 0 : payrollBreakMinutes({ schedule, policy, grossMinutes });
    const netMinutes = Math.max(0, grossMinutes - breakMinutes);
    if (policy.payroll_rounding_enabled === false) return sum + netMinutes;
    const unit = Number(policy.attendance_rounding_minutes || 30);
    if (!unit) return sum + netMinutes;
    const mode = policy.attendance_rounding_mode;
    const rounded = mode === 'floor' ? Math.floor(netMinutes / unit) * unit
      : mode === 'nearest' ? Math.round(netMinutes / unit) * unit
        : Math.ceil(netMinutes / unit) * unit;
    return sum + rounded;
  }, 0);
  const amount = payType === 'monthly' ? Number(rate) || 0
    : payType === 'annual' ? (Number(rate) || 0) / 12
      : payType === 'daily' ? shifts.length * (Number(rate) || 0)
        : scheduledMinutes / 60 * (Number(rate) || 0);
  return { scheduledMinutes, scheduledDays: shifts.length, scheduledPay: amount };
}
