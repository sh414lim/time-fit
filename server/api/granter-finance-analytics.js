import { granterConfigured, granterRequest } from './_granter.js';
import { authorizeFinance, financeError, methodNotAllowed } from './_finance-server.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 10 * 60 * 1000;
const TRANSACTION_LIMIT = 4000;
const FALLBACK_HISTORY_START = '2018-01-01';
const REQUEST_GAP_MS = 350;
const PERIOD_REQUEST_TIMEOUT_MS = 8000;
const PERIOD_BUDGET_MS = 26000;
// Granter allows up to 366 calendar days per request. Using the full window
// keeps all-source collection fast while the requests themselves stay serial.
const WINDOW_DAYS = 365;

export const GRANTER_FINANCE_TICKET_TYPES = Object.freeze([
  'EXPENSE_TICKET',
  'BANK_TRANSACTION_TICKET',
  'TAX_INVOICE_TICKET',
  'CASH_RECEIPT_TICKET',
  'MANUAL_TRANSACTION_TICKET',
  'MERCHANT_CARD_TRANSACTION_TICKET',
  'MERCHANT_CARD_SETTLEMENT_DETAIL_TICKET',
  'ECOMMERCE_SETTLEMENT_DETAIL_TICKET',
  'ECOMMERCE_SALES_DETAIL_TICKET',
  'SOCIAL_INSURANCE_PREMIUM_TICKET',
  'PG_SETTLEMENT_DETAIL_TICKET',
  'PG_TRANSACTION_TICKET',
]);

export const GRANTER_TICKET_LABELS = Object.freeze({
  EXPENSE_TICKET: '법인카드',
  BANK_TRANSACTION_TICKET: '통장',
  TAX_INVOICE_TICKET: '세금계산서',
  CASH_RECEIPT_TICKET: '현금영수증',
  MANUAL_TRANSACTION_TICKET: '수기전표',
  MERCHANT_CARD_TRANSACTION_TICKET: '가맹점 카드매출',
  MERCHANT_CARD_SETTLEMENT_DETAIL_TICKET: '가맹점 정산',
  ECOMMERCE_SETTLEMENT_DETAIL_TICKET: '이커머스 정산',
  ECOMMERCE_SALES_DETAIL_TICKET: '이커머스 매출',
  SOCIAL_INSURANCE_PREMIUM_TICKET: '사회보험료',
  PG_SETTLEMENT_DETAIL_TICKET: 'PG 정산',
  PG_TRANSACTION_TICKET: 'PG 거래',
});

const ASSET_TYPES = Object.freeze([
  'CARD',
  'BANK_ACCOUNT',
  'HOME_TAX_ACCOUNT',
  'SOCIAL_INSURANCE_ACCOUNT',
  'PG',
  'ECOMMERCE',
  'MERCHANT_GROUP',
]);

const cache = globalThis.__timefitGranterFinanceAnalyticsCache
  || (globalThis.__timefitGranterFinanceAnalyticsCache = new Map());

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(Math.round(parsed)) : 0;
};
const dateKey = value => String(value || '').slice(0, 10);
const monthKey = value => dateKey(value).slice(0, 7);
const text = (...values) => values.map(value => String(value || '').trim()).find(Boolean) || '';
const arrayPayload = value => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : [];

const registrationNumber = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
};

export function todayInSeoul(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateWindows(from, to) {
  const windows = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const windowEnd = new Date(Math.min(end.getTime(), cursor.getTime() + WINDOW_DAYS * 86400000));
    windows.push({ startDate: cursor.toISOString().slice(0, 10), endDate: windowEnd.toISOString().slice(0, 10) });
    cursor = new Date(windowEnd.getTime() + 86400000);
  }
  return windows;
}

function trendStart(from, months = 6) {
  const [year, month] = String(from).slice(0, 7).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - months, 1));
  return date.toISOString().slice(0, 10);
}

function nestedAsset(ticket = {}) {
  return ticket.asset
    || ticket.cardUsage?.card
    || ticket.purchaseUsage?.card
    || ticket.bankTransaction?.asset
    || ticket.merchantCardTransaction?.asset
    || ticket.merchantPurchaseTransaction?.asset
    || ticket.merchantSettlementDetail?.asset
    || ticket.pgTransaction?.asset
    || ticket.pgSettlementDetail?.asset
    || ticket.ecommerceSalesDetail?.asset
    || ticket.ecommerceSettlementDetail?.asset
    || null;
}

export function normalizeGranterFinanceTicket(ticket = {}, requestedType, assetsById = new Map(), contactsById = new Map()) {
  const id = Number(ticket.id);
  const ticketType = requestedType || ticket.ticketType;
  const amount = number(ticket.amount
    ?? ticket.purchaseUsage?.amount
    ?? ticket.cardUsage?.amount
    ?? ticket.bankTransaction?.amount
    ?? ticket.taxInvoice?.totalAmount
    ?? ticket.cashReceipt?.totalAmount);
  const occurredAt = text(
    ticket.transactAt,
    ticket.purchaseUsage?.purchaseDate,
    ticket.purchaseUsage?.paymentDate,
    ticket.cardUsage?.paymentDate,
    ticket.createdAt,
  );
  if (!Number.isInteger(id) || id <= 0 || !amount || !DATE_PATTERN.test(dateKey(occurredAt))) return null;

  const rawDirection = String(ticket.transactionType || ticket.bankTransaction?.transactionType || 'OUT').toUpperCase();
  const direction = rawDirection === 'IN' ? 'in' : 'out';
  const rawAsset = nestedAsset(ticket);
  const assetId = Number(ticket.assetId || rawAsset?.id) || null;
  const referenceAsset = assetId ? assetsById.get(String(assetId)) : null;
  const assetName = text(
    referenceAsset?.name,
    rawAsset?.nickname,
    rawAsset?.name,
    rawAsset?.organizationName,
    ticket.assetName,
    '자산 미확인',
  );
  const category = ticket.expenseCategory;
  const rawContact = ticket.contact;
  const contactId = Number(rawContact?.id || ticket.contactId) || null;
  const referenceContact = contactId ? contactsById.get(String(contactId)) : null;
  const contactName = typeof rawContact === 'string'
    ? rawContact
    : text(rawContact?.name, rawContact?.companyName, referenceContact?.companyName, referenceContact?.name, ticket.contactName, '거래처 미확인');
  const taxInvoice = ticket.taxInvoice || ticket.taxInvoiceTicket || {};
  const cashReceipt = ticket.cashReceipt || ticket.cashReceiptTicket || {};
  const businessNumber = registrationNumber(
    rawContact?.registrationNumber
    || referenceContact?.registrationNumber
    || ticket.purchaseUsage?.storeCorporateNumber
    || ticket.cardUsage?.storeCorporateNumber
    || taxInvoice.supplier?.registrationNumber
    || taxInvoice.contractor?.registrationNumber
    || cashReceipt.supplier?.registrationNumber
    || cashReceipt.contractor?.registrationNumber
    || ticket.registrationNumber,
  );
  const tags = (Array.isArray(ticket.ticketTags) ? ticket.ticketTags : []).map(tag => ({
    id: Number(tag.id) || null,
    name: text(tag.name, '이름 없는 태그'),
    group: text(tag.ticketTagGroup?.name, tag.group, '그룹 없음'),
  }));

  return {
    id: `${ticketType}:${id}`,
    ticketId: id,
    ticketType,
    ticketTypeLabel: GRANTER_TICKET_LABELS[ticketType] || ticketType,
    occurredAt,
    date: dateKey(occurredAt),
    month: monthKey(occurredAt),
    amount,
    direction,
    content: text(ticket.content, ticket.description, ticket.cardUsage?.storeName, ticket.purchaseUsage?.storeName, '내용 미확인'),
    description: text(ticket.description),
    categoryId: Number(category?.id || ticket.expenseCategoryId) || null,
    category: text(category?.name, ticket.expenseCategoryName, '미분류'),
    categorySeries: text(category?.subInfo, '계열 미분류'),
    tags,
    assetId,
    asset: assetName,
    assetType: text(referenceAsset?.assetType, rawAsset?.assetType, 'UNKNOWN'),
    contactId,
    contact: contactName,
    businessNumber,
    supplierBusinessNumber: registrationNumber(taxInvoice.supplier?.registrationNumber),
    contractorBusinessNumber: registrationNumber(taxInvoice.contractor?.registrationNumber),
    isIncluded: ticket.isIncluded !== false,
    isClassified: Boolean(category?.id || ticket.expenseCategoryId),
    attachmentCount: Number(ticket.attachmentCount || 0),
    commentCount: Number(ticket.commentCount || ticket.messageCount || 0),
    referenceCount: Array.isArray(ticket.ticketReferences) ? ticket.ticketReferences.length : Number(ticket.connectionCount || 0),
  };
}

function emptyGroup(key, label) {
  return { key: String(key), label, count: 0, inAmount: 0, outAmount: 0, netAmount: 0 };
}

function addToGroup(group, row) {
  group.count += 1;
  if (row.direction === 'in') group.inAmount += row.amount;
  else group.outAmount += row.amount;
  group.netAmount = group.inAmount - group.outAmount;
}

export function groupGranterFinanceRows(rows = [], dimension) {
  const groups = new Map();
  const add = (key, label, row) => {
    const safeKey = String(key || label || 'unknown');
    const group = groups.get(safeKey) || emptyGroup(safeKey, label || '미확인');
    addToGroup(group, row);
    groups.set(safeKey, group);
  };
  rows.filter(row => row.isIncluded).forEach(row => {
    if (dimension === 'category') add(row.categoryId || 'uncategorized', row.category, row);
    else if (dimension === 'categorySeries') add(row.categorySeries, row.categorySeries, row);
    else if (dimension === 'asset') add(row.assetId || row.asset, row.asset, row);
    else if (dimension === 'contact') add(row.contactId || row.contact, row.contact, row);
    else if (dimension === 'businessNumber') add(row.businessNumber || 'unknown', row.businessNumber || '사업자번호 미확인', row);
    else if (dimension === 'ticketType') add(row.ticketType, row.ticketTypeLabel, row);
    else if (dimension === 'month') add(row.month, row.month, row);
    else if (dimension === 'day') add(row.date, row.date, row);
    else if (dimension === 'direction') add(row.direction, row.direction === 'in' ? '입금·수입' : '출금·지출', row);
    else if (dimension === 'tag') {
      if (!row.tags.length) add('untagged', '태그 없음', row);
      else row.tags.forEach(tag => add(tag.id || tag.name, tag.name, row));
    }
  });
  return [...groups.values()].sort((a, b) => Math.max(b.inAmount, b.outAmount) - Math.max(a.inAmount, a.outAmount) || b.count - a.count);
}

export function summarizeGranterFinanceRows(rows = []) {
  const included = rows.filter(row => row.isIncluded);
  const inAmount = included.filter(row => row.direction === 'in').reduce((sum, row) => sum + row.amount, 0);
  const outAmount = included.filter(row => row.direction === 'out').reduce((sum, row) => sum + row.amount, 0);
  return {
    sourceCount: rows.length,
    includedCount: included.length,
    excludedCount: rows.length - included.length,
    classifiedCount: included.filter(row => row.isClassified).length,
    unclassifiedCount: included.filter(row => !row.isClassified).length,
    connectedCount: included.filter(row => row.referenceCount > 0).length,
    attachmentCount: included.reduce((sum, row) => sum + row.attachmentCount, 0),
    inAmount,
    outAmount,
    netAmount: inAmount - outAmount,
  };
}

async function pooled(items, worker, concurrency = 3) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      try { results[current] = { status: 'fulfilled', value: await worker(items[current]) }; }
      catch (reason) { results[current] = { status: 'rejected', reason }; }
    }
  });
  await Promise.all(runners);
  return results;
}

export async function settleGranterRequests(tasks, { gapMs = REQUEST_GAP_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const results = [];
  for (let index = 0; index < tasks.length; index += 1) {
    try { results.push({ status: 'fulfilled', value: await tasks[index]() }); }
    catch (reason) { results.push({ status: 'rejected', reason }); }
    if (gapMs > 0 && index < tasks.length - 1) await wait(gapMs);
  }
  return results;
}

function deadlineExceeded() {
  const error = new Error('granter_progressive_sync_deadline_exceeded');
  error.name = 'TimeoutError';
  error.status = 504;
  return error;
}

async function granterRequestWithRetry(path, options, attempts = 4, { deadlineAt = Number.POSITIVE_INFINITY, timeoutMs = 30000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw deadlineExceeded();
      return await granterRequest(path, {
        ...(options || {}),
        timeoutMs: Math.min(timeoutMs, remainingMs),
      });
    } catch (error) {
      lastError = error;
      const retryable = error?.status === 429 || Number(error?.status) >= 500 || error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** attempt)));
    }
  }
  throw lastError;
}

export function granterAttemptsForScope(scope) {
  return scope === 'period' ? 1 : 2;
}

export function granterBudgetForScope(scope) {
  return scope === 'period'
    ? { budgetMs: PERIOD_BUDGET_MS, timeoutMs: PERIOD_REQUEST_TIMEOUT_MS }
    : { budgetMs: 110000, timeoutMs: 30000 };
}

export function granterPayloadCacheable(payload) {
  return !(payload?.sourceStatus || []).some(item =>
    item.status === 'failed' && (item.statusCode === 429 || Number(item.statusCode) >= 500),
  );
}

async function loadAssets(attempts, requestPolicy) {
  const settled = await settleGranterRequests(ASSET_TYPES.map(assetType => async () => {
    const result = await granterRequestWithRetry('/api/public-docs/assets', { method: 'POST', body: { assetType } }, attempts, requestPolicy);
    return { assetType, rows: arrayPayload(result.payload), revision: result.revision };
  }));
  const rows = [];
  const warnings = [];
  let revision = null;
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      revision ||= result.value.revision;
      result.value.rows.forEach(asset => rows.push({ ...asset, assetType: asset.assetType || result.value.assetType }));
    } else warnings.push(`asset:${ASSET_TYPES[index]}`);
  });
  return { rows, warnings, revision };
}

function earliestAvailableDate({ workspace, assets }) {
  const candidates = [
    process.env.GRANTER_HISTORY_START_DATE,
    workspace.createdAt,
    workspace.startDate,
    ...assets.flatMap(asset => [asset.startDate, asset.createdAt]),
  ].map(dateKey).filter(value => DATE_PATTERN.test(value));
  return candidates.sort()[0] || FALLBACK_HISTORY_START;
}

async function buildAnalytics({ from, to, scope }) {
  const attempts = granterAttemptsForScope(scope);
  const budget = granterBudgetForScope(scope);
  const requestPolicy = { deadlineAt: Date.now() + budget.budgetMs, timeoutMs: budget.timeoutMs };
  const [workspaceResult, subscriptionResult, categoriesResult, tagsResult, contactsResult, assetResult] = await settleGranterRequests([
    () => granterRequestWithRetry('/api/public-docs/workspace-profile', undefined, attempts, requestPolicy),
    () => granterRequestWithRetry('/api/public-docs/subscription', undefined, attempts, requestPolicy),
    () => granterRequestWithRetry('/api/public-docs/categories', undefined, attempts, requestPolicy),
    () => granterRequestWithRetry('/api/public-docs/ticket-tags', undefined, attempts, requestPolicy),
    () => granterRequestWithRetry('/api/public-docs/contacts', undefined, attempts, requestPolicy),
    () => loadAssets(attempts, requestPolicy),
  ]);
  const authorizationFailure = [workspaceResult, subscriptionResult, categoriesResult, tagsResult, contactsResult]
    .find(result => result.status === 'rejected' && [401, 403].includes(Number(result.reason?.status)));
  if (authorizationFailure) throw authorizationFailure.reason;
  const warnings = [];
  const value = (result, key, fallback) => {
    if (result.status === 'fulfilled') return result.value.payload;
    warnings.push(key); return fallback;
  };
  const workspace = value(workspaceResult, 'workspace', {});
  const subscription = value(subscriptionResult, 'subscription', {});
  const categories = arrayPayload(value(categoriesResult, 'categories', []));
  const tags = arrayPayload(value(tagsResult, 'tags', []));
  const contacts = arrayPayload(value(contactsResult, 'contacts', []));
  const assetBundle = assetResult.status === 'fulfilled' ? assetResult.value : { rows: [], warnings: ['assets'], revision: null };
  warnings.push(...assetBundle.warnings);
  const assets = assetBundle.rows;
  const assetsById = new Map(assets.map(asset => [String(asset.id), asset]));
  const contactsById = new Map(contacts.map(contact => [String(contact.id), contact]));
  const startDate = scope === 'all'
    ? earliestAvailableDate({ workspace, assets })
    : trendStart(from, 6);
  const windows = dateWindows(startDate, to);

  const ticketResults = await pooled(GRANTER_FINANCE_TICKET_TYPES, async ticketType => {
    const rows = [];
    let revision = null;
    for (const window of windows) {
      const result = await granterRequestWithRetry('/api/public-docs/tickets', { method: 'POST', body: { ticketType, ...window } }, attempts, requestPolicy);
      revision ||= result.revision;
      rows.push(...arrayPayload(result.payload));
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { ticketType, rows, revision };
  }, 1);
  const ticketAuthorizationFailure = ticketResults.find(result =>
    result.status === 'rejected' && [401, 403].includes(Number(result.reason?.status)),
  );
  if (ticketAuthorizationFailure) throw ticketAuthorizationFailure.reason;
  const allRows = [];
  const sourceStatus = [];
  let revision = assetBundle.revision
    || (workspaceResult.status === 'fulfilled' ? workspaceResult.value.revision : null)
    || null;
  ticketResults.forEach((result, index) => {
    const ticketType = GRANTER_FINANCE_TICKET_TYPES[index];
    if (result.status === 'rejected') {
      warnings.push(`ticket:${ticketType}`);
      const statusCode = Number(result.reason?.status) || null;
      sourceStatus.push({
        ticketType,
        label: GRANTER_TICKET_LABELS[ticketType],
        status: 'failed',
        count: 0,
        statusCode,
        reason: statusCode === 401 || statusCode === 403
          ? 'API 키·권한 확인'
          : statusCode === 400
            ? '연동 자산 확인'
            : statusCode === 429
              ? '요청 제한 · 다시 시도'
              : statusCode === 504
                ? '응답 지연 · 다시 시도'
              : result.reason?.message === 'granter_response_too_large'
                ? '조회량 분할 필요'
                : '연동 확인',
      });
      return;
    }
    revision ||= result.value.revision;
    const normalized = result.value.rows.map(row => normalizeGranterFinanceTicket(row, ticketType, assetsById, contactsById)).filter(Boolean);
    allRows.push(...normalized);
    sourceStatus.push({ ticketType, label: GRANTER_TICKET_LABELS[ticketType], status: 'loaded', count: normalized.length });
  });

  const dedupedRows = [...new Map(allRows.map(row => [row.id, row])).values()];
  const selectedRows = (scope === 'all' ? dedupedRows : dedupedRows.filter(row => row.date >= from && row.date <= to)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const includedRows = selectedRows.filter(row => row.isIncluded);
  const categorySeries = categories.reduce((map, category) => {
    const key = category.subInfo || '계열 미분류';
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());
  const assetTypes = assets.reduce((map, asset) => {
    const key = asset.assetType || 'UNKNOWN';
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());

  return {
    ok: true,
    configured: true,
    scope,
    range: { from: scope === 'all' ? startDate : from, to, trendFrom: startDate },
    workspace: { id: workspace.workspaceId || workspace.id || null, name: workspace.companyName || workspace.name || 'Granter 워크스페이스' },
    subscription: { status: subscription.status || subscription.subscriptionStatus || 'UNKNOWN', plan: subscription.planName || subscription.plan || null },
    apiRevision: revision,
    generatedAt: new Date().toISOString(),
    warnings,
    summary: summarizeGranterFinanceRows(selectedRows),
    groups: {
      categories: groupGranterFinanceRows(includedRows, 'category'),
      categorySeries: groupGranterFinanceRows(includedRows, 'categorySeries'),
      tags: groupGranterFinanceRows(includedRows, 'tag'),
      assets: groupGranterFinanceRows(includedRows, 'asset'),
      contacts: groupGranterFinanceRows(includedRows, 'contact'),
      businessNumbers: groupGranterFinanceRows(includedRows, 'businessNumber'),
      ticketTypes: groupGranterFinanceRows(includedRows, 'ticketType'),
      directions: groupGranterFinanceRows(includedRows, 'direction'),
      days: groupGranterFinanceRows(includedRows, 'day').sort((a, b) => a.key.localeCompare(b.key)),
      months: groupGranterFinanceRows(dedupedRows, 'month').sort((a, b) => a.key.localeCompare(b.key)),
    },
    references: {
      accountingCategoryCount: categories.length,
      accountingCategorySeries: [...categorySeries.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      tags: tags.filter(tag => tag.isHidden !== true).map(tag => ({ id: tag.id, name: tag.name, group: tag.ticketTagGroup?.name || tag.group || null })),
      contactCount: contacts.length,
      contacts: contacts.map(contact => ({
        id: contact.id,
        name: contact.companyName || contact.name || '거래처',
        registrationNumber: registrationNumber(contact.registrationNumber),
      })),
      assets: assets.map(asset => ({ id: asset.id, assetType: asset.assetType, name: asset.name || asset.nickname || asset.organizationName || '자산', organizationName: asset.organizationName || null, maskedNumber: asset.maskedNumber || (asset.number ? `•••• ${String(asset.number).replace(/\D/g, '').slice(-4)}` : null), isActive: asset.isActive !== false })),
      assetTypes: [...assetTypes.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
    sourceStatus,
    partial: warnings.length > 0 || sourceStatus.some(item => item.status === 'failed'),
    retryableSourceTypes: sourceStatus
      .filter(item => item.status === 'failed' && (item.statusCode === 429 || Number(item.statusCode) >= 500))
      .map(item => item.ticketType),
    transactions: selectedRows.slice(0, TRANSACTION_LIMIT),
    transactionsTruncated: selectedRows.length > TRANSACTION_LIMIT,
    taxInvoices: selectedRows.filter(row => row.ticketType === 'TAX_INVOICE_TICKET'),
    tagsMayOverlap: true,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  const { organizationId, from, to } = req.query || {};
  const scope = req.query?.scope === 'all' ? 'all' : 'period';
  if (!DATE_PATTERN.test(from || '') || !DATE_PATTERN.test(to || '') || from > to) return res.status(400).json({ ok: false, error: '조회 기간을 확인해 주세요.' });
  const effectiveTo = scope === 'all' ? todayInSeoul() : to;
  const auth = await authorizeFinance(req, organizationId, { permissionsAny: ['finance.view', 'expense.manage', 'expense.card.manage'] });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '재무 조회 권한이 필요합니다.' });
  if (!granterConfigured()) return res.status(200).json({ ok: true, configured: false, error: 'Granter API 키가 설정되지 않았습니다.' });

  const cacheKey = `${organizationId}:${scope}:${from}:${effectiveTo}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return res.status(200).json({ ...cached.payload, cached: true });
  try {
    const payload = await buildAnalytics({ from, to: effectiveTo, scope });
    if (granterPayloadCacheable(payload)) cache.set(cacheKey, { createdAt: Date.now(), payload });
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    return res.status(200).json(payload);
  } catch (error) {
    return financeError(res, error, 'Granter 재무 데이터를 불러오지 못했습니다.');
  }
}
