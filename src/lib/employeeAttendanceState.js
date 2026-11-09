export const EMPLOYEE_ATTENDANCE_ACTIONS = Object.freeze({
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
  COMPLETED: 'completed',
});

export function attendanceActionForRecord(record) {
  if (record?.checked_in_at && record?.checked_out_at) {
    return EMPLOYEE_ATTENDANCE_ACTIONS.COMPLETED;
  }
  if (record?.checked_in_at) return EMPLOYEE_ATTENDANCE_ACTIONS.CHECK_OUT;
  return EMPLOYEE_ATTENDANCE_ACTIONS.CHECK_IN;
}

export function attendanceActionForEmployee(employee, workDate) {
  const record = (employee?.attendanceHistory || []).find(
    item => item.work_date === workDate,
  );
  return attendanceActionForRecord(record);
}

export function attendanceActionLabel(action) {
  if (action === EMPLOYEE_ATTENDANCE_ACTIONS.CHECK_OUT) return '퇴근 기록';
  if (action === EMPLOYEE_ATTENDANCE_ACTIONS.COMPLETED) return '출퇴근 완료';
  return '출근 기록';
}
