export const kstDate = (value = new Date()) => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10);
export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && addDays(value, 0) === value;
export function lastCompleteWeek(today = kstDate()) {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const from = addDays(today, -((day + 6) % 7) - 7);
  return { from, to: addDays(from, 6), previousFrom: addDays(from, -7), previousTo: addDays(from, -1) };
}
export const changePercent = (current, previous) => previous > 0 ? (current - previous) / previous * 100 : null;

export function validAttendanceCorrection({ date, checkedIn, checkedOut, reason, requireCheckout = false }, now = new Date()) {
  const start = Date.parse(`${checkedIn}+09:00`), end = checkedOut ? Date.parse(`${checkedOut}+09:00`) : null;
  return validDate(date) && checkedIn.slice(0, 10) === date && Number.isFinite(start) && start <= +now
    && (!requireCheckout || end !== null) && (end === null || (Number.isFinite(end) && end > start && end <= +now && end - start <= 48 * 3600000))
    && reason.trim().length >= 2 && reason.length <= 500;
}

// Past, approved shifts only. Overnight shifts remain open until their end;
// without a schedule, an open record is only flagged after 24 hours.
export function attendanceIssues(employees, { from, to, now = new Date(), leaves = [] }) {
  const issues = [];
  for (const employee of employees) {
    const records = new Map((employee.attendanceHistory || []).map(row => [row.work_date, row]));
    const schedules = new Map((employee.scheduleHistory || []).filter(row => row.approval_status === 'approved').map(row => [row.work_date, row]));
    for (const date of new Set([...records.keys(), ...schedules.keys()])) {
      if (date < from || date > to || date >= kstDate(now)) continue;
      const record = records.get(date), schedule = schedules.get(date);
      const working = schedule && !schedule.is_day_off && schedule.starts_at && schedule.ends_at;
      const endDate = working && schedule.ends_at <= schedule.starts_at ? addDays(date, 1) : date;
      const ended = working && Date.parse(`${endDate}T${schedule.ends_at}+09:00`) <= +now;
      const approvedLeave = leaves.some(leave => leave.staffId === employee.id && leave.status === '승인 완료' && !String(leave.type).includes('반차') && parseFloat(leave.amount) >= 1 && leave.startsAt <= date && (leave.endsAt || leave.startsAt) >= date);
      const types = [];
      if (record?.checked_in_at && !record.checked_out_at && (working ? ended : +now - Date.parse(record.checked_in_at) >= 86400000)) types.push('checkout');
      if (working && ended && !record?.checked_in_at && !approvedLeave) types.push('absent');
      if (record?.checked_in_at && !working) types.push('schedule');
      if (types.length) issues.push({ key: `${employee.id}:${date}`, employee, date, record, schedule, types });
    }
  }
  return issues.sort((a, b) => a.date.localeCompare(b.date) || a.employee.name.localeCompare(b.employee.name));
}

export function weeklySales(orders, daily, range, connection) {
  const summarize = (from, to) => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(from, i);
      const rows = orders.filter(order => kstDate(order.ordered_at) === date);
      const completed = rows.filter(order => order.state === 'COMPLETED');
      const cache = daily.find(row => row.sales_date === date);
      return { date, revenue: completed.reduce((sum, order) => sum + Number(order.total_amount), 0), orders: completed.length, covered: Boolean(cache && Number(cache.order_count) === rows.length) };
    });
    const completed = orders.filter(order => order.state === 'COMPLETED' && kstDate(order.ordered_at) >= from && kstDate(order.ordered_at) <= to);
    const menus = new Map();
    for (const order of completed) for (const line of order.raw_order?.lineItems || []) {
      const quantity = Number(line.quantity), price = Number(line.itemPrice?.priceValue);
      if (!line.item?.title || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;
      const name = line.item.title;
      menus.set(name, (menus.get(name) || 0) + quantity);
    }
    const revenue = days.reduce((sum, day) => sum + day.revenue, 0);
    const count = completed.length;
    return { from, to, days, revenue, orders: count, average: count ? revenue / count : null, menus: [...menus].map(([name, quantity]) => ({ name, quantity })), menuComplete: completed.every(order => Array.isArray(order.raw_order?.lineItems) && order.raw_order.lineItems.length > 0), covered: days.every(day => day.covered) && Date.parse(connection?.last_synced_at) >= Date.parse(`${addDays(to, 1)}T00:00:00+09:00`) };
  };
  const current = summarize(range.from, range.to), previous = summarize(range.previousFrom, range.previousTo);
  const comparable = current.covered && previous.covered;
  const menuComparable = comparable && current.menuComplete && previous.menuComplete;
  const menus = current.menus.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 5).map(menu => ({ ...menu, previous: menuComparable ? previous.menus.find(row => row.name === menu.name)?.quantity || 0 : null }));
  delete current.menus; delete previous.menus;
  return { current, previous, comparable, menuComparable, menus, syncedAt: connection?.last_synced_at || null, syncError: Boolean(connection?.last_error), connected: Boolean(connection?.merchant_id) };
}
