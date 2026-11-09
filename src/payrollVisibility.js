export function hasPayrollWorkday(row) {
  return Number(row?.completedDays || 0) > 0 || Number(row?.scheduledDays || 0) > 0;
}

export function isVisibleAttendanceDay(row) {
  const isDayOff = ['휴무', '연차'].includes(String(row?.schedule || '').trim());
  const hasActualAttendance = Boolean(row?.checkedInAt || row?.checkedOutAt);
  return !isDayOff || hasActualAttendance;
}
