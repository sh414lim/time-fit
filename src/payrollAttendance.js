import { payrollBreakMinutes } from './payrollBreakPolicy.js';
import { roundPayableMinutes } from './payrollRounding.js';

export const attendanceMinutes = record => {
  if (!record?.checked_in_at || !record?.checked_out_at) return 0;
  return Math.max(0, (new Date(record.checked_out_at).getTime() - new Date(record.checked_in_at).getTime()) / 60000);
};

export const clockMinutes = value => { const [hour, minute] = String(value || '0:0').split(':').map(Number); return hour * 60 + minute; };

export const attendanceMinuteOnWorkDate = (timestamp, workDate) => {
  if (!timestamp || !workDate) return 0;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const actualDate = `${parts.year}-${parts.month}-${parts.day}`;
  const dayOffset = Math.round((Date.parse(`${actualDate}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / 86400000);
  return dayOffset * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
};

export function payableAttendanceMinutes(record, schedules = [], policy = {}) {
  if (!record?.checked_in_at || !record?.checked_out_at) return { grossMinutes: 0, breakMinutes: 0, payableMinutes: 0, schedule: null };
  const includeAfterScheduledEnd = policy.payroll_include_after_scheduled_end === true;
  const schedule = schedules.find(item => item.staff_id === record.staff_id && item.work_date === record.work_date && !item.is_day_off && item.starts_at && (includeAfterScheduledEnd || item.ends_at)) || null;
  let grossMinutes = attendanceMinutes(record);
  if (schedule && includeAfterScheduledEnd) {
    // The opt-in workplace policy keeps the scheduled start floor, but pays
    // through the actual checkout, including overnight work and exact seconds.
    const scheduledStart = Date.parse(`${record.work_date}T${schedule.starts_at}+09:00`);
    const actualStart = Date.parse(record.checked_in_at);
    const actualEnd = Date.parse(record.checked_out_at);
    grossMinutes = Math.max(0, (actualEnd - Math.max(actualStart, scheduledStart)) / 60000);
  } else if (schedule) {
    // Preserve the existing schedule-end cap for every non-opted-in workplace.
    const scheduledStart = clockMinutes(schedule.starts_at); let scheduledEnd = clockMinutes(schedule.ends_at);
    if (scheduledEnd <= scheduledStart) scheduledEnd += 1440;
    const actualStart = attendanceMinuteOnWorkDate(record.checked_in_at, record.work_date);
    const actualEnd = attendanceMinuteOnWorkDate(record.checked_out_at, record.work_date);
    grossMinutes = Math.max(0, Math.min(actualEnd, scheduledEnd) - Math.max(actualStart, scheduledStart));
  }
  const breakMinutes = schedule?.break_paid === true ? 0 : payrollBreakMinutes({ schedule, policy, grossMinutes });
  const netMinutes = Math.max(0, grossMinutes - breakMinutes);
  const payableMinutes = roundPayableMinutes(netMinutes, policy);
  return { grossMinutes, breakMinutes, payableMinutes, schedule };
}
