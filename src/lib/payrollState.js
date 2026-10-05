const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function payrollMonthStorageKey(accountId, organizationId) {
  return accountId && organizationId ? `timefit:payroll-month:${accountId}:${organizationId}` : null;
}

export function readPayrollMonth(storage, accountId, organizationId, fallback) {
  const key = payrollMonthStorageKey(accountId, organizationId);
  if (!key || !storage) return fallback;
  try {
    const saved = storage.getItem(key);
    return MONTH_PATTERN.test(saved || '') ? saved : fallback;
  } catch {
    return fallback;
  }
}

export function writePayrollMonth(storage, accountId, organizationId, month) {
  const key = payrollMonthStorageKey(accountId, organizationId);
  if (!key || !storage || !MONTH_PATTERN.test(month || '')) return;
  try { storage.setItem(key, month); } catch { /* Storage can be unavailable in private browsing. */ }
}
