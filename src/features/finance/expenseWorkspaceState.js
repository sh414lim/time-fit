const WORKSPACE_SECTIONS = new Set(['overview', 'ledger', 'evidence', 'cards', 'settlement']);
const REVIEW_STATUSES = new Set(['attention', 'processing', 'submitter_review', 'manager_review', 'change_requested', 'approved', 'failed']);

const safeId = value => String(value || '').trim() || 'unknown';

export function expenseWorkspaceStateKey(accountId, organizationId) {
  return `timefit:expense-workspace:${safeId(accountId)}:${safeId(organizationId)}`;
}

export function expenseReviewStateKey(accountId, organizationId) {
  return `${expenseWorkspaceStateKey(accountId, organizationId)}:review`;
}

export function normalizeExpenseWorkspaceState(value = {}) {
  return {
    section: WORKSPACE_SECTIONS.has(value?.section) ? value.section : 'overview',
  };
}

export function normalizeExpenseReviewState(value = {}) {
  return {
    status: REVIEW_STATUSES.has(value?.status) ? value.status : 'attention',
    costCenterId: String(value?.costCenterId || ''),
    expandedId: String(value?.expandedId || ''),
  };
}

export function readExpenseUiState(key, normalize, storage) {
  try {
    const target = storage || globalThis.sessionStorage;
    return normalize(JSON.parse(target?.getItem(key) || 'null') || {});
  } catch {
    return normalize({});
  }
}

export function writeExpenseUiState(key, value, normalize, storage) {
  try {
    const target = storage || globalThis.sessionStorage;
    target?.setItem(key, JSON.stringify(normalize(value)));
  } catch {
    // Session storage is an optional navigation aid.
  }
}
