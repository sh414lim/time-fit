import { createTimefitAxSignedUrl, googleDriveReceiptUrl } from './_timefit-ax.js';

const DEFAULT_BASE_URL = 'https://app.granter.biz';
// A 366-day ticket query can legitimately contain thousands of bank,
// settlement, and tax-document rows. Keep a bounded response, but allow the
// documented full-history windows to pass without truncating valid data.
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const READ_ONLY_POST_PATHS = new Set([
  '/api/public-docs/tickets',
  '/api/public-docs/tickets/detail',
  '/api/public-docs/assets',
  '/api/public-docs/balances',
  '/api/public-docs/daily-financial-report',
  '/api/public-docs/exchange-rates',
  '/api/public-docs/salary-histories',
  '/api/public-docs/attendances',
  '/api/public-docs/leave-balances',
  '/api/public-docs/leave-histories',
  '/api/public-docs/holidays',
]);

export function granterConfigured() {
  return Boolean([
    process.env.GRANTER_READ_API_KEY,
    process.env.GRANTER_LIVE_API_KEY,
    process.env.GRANTER_TEST_API_KEY,
    process.env.GRANTER_API_KEY,
  ].some(value => String(value || '').trim()));
}

export function granterApiKey({ path = '', method = 'GET', env = process.env } = {}) {
  const pathname = String(path || '').split('?')[0];
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const isReadRequest = normalizedMethod === 'GET'
    || (normalizedMethod === 'POST' && READ_ONLY_POST_PATHS.has(pathname));
  const vercelEnvironment = String(env.VERCEL_ENV || '').toLowerCase();
  const isProduction = vercelEnvironment === 'production'
    || (!vercelEnvironment && String(env.NODE_ENV || '').toLowerCase() === 'production');
  const readKey = String(env.GRANTER_READ_API_KEY || '').trim();
  const liveKey = String(env.GRANTER_LIVE_API_KEY || '').trim();
  const testKey = String(env.GRANTER_TEST_API_KEY || '').trim();
  const legacyKey = String(env.GRANTER_API_KEY || '').trim();

  if (!isProduction && testKey) return testKey;
  if (isReadRequest && readKey) return readKey;
  if (liveKey) return liveKey;
  if (legacyKey) return legacyKey;
  if (testKey) return testKey;
  if (readKey) return readKey;
  return '';
}

export function granterBaseUrl(value = process.env.GRANTER_API_BASE_URL) {
  const url = new URL(String(value || DEFAULT_BASE_URL).trim().replace(/\/$/, ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('granter_base_url_invalid');
  if (process.env.NODE_ENV === 'production' && url.hostname !== 'app.granter.biz') throw new Error('granter_base_url_not_allowed');
  return url.toString().replace(/\/$/, '');
}

export function normalizedRegistrationNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

export function findGranterContact(contacts = [], registrationNumber) {
  const target = normalizedRegistrationNumber(registrationNumber);
  if (!target) return null;
  return contacts.find(contact => normalizedRegistrationNumber(contact?.registrationNumber) === target) || null;
}

export function findGranterCategory(categories = [], categoryName) {
  const target = String(categoryName || '').trim().replace(/\s+/g, '').toLowerCase();
  if (!target) return null;
  return categories.find(category => String(category?.name || '').trim().replace(/\s+/g, '').toLowerCase() === target && category?.isHidden !== true) || null;
}

export function granterTradeItems(lines = [], totalAmount) {
  const normalized = lines.map((line, index) => {
    const amount = Number(line?.line_amount ?? line?.lineAmount);
    const quantity = Number(line?.quantity) > 0 ? Number(line.quantity) : 1;
    const unitPrice = Number(line?.unit_price ?? line?.unitPrice);
    return {
      itemName: String(line?.item_name_normalized || line?.item_name_raw || line?.itemName || `품목 ${index + 1}`).trim().slice(0, 255),
      quantity,
      unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : amount / quantity,
      taxAmount: 0,
      isIncludedVat: true,
      amount,
    };
  }).filter(item => item.itemName && Number.isFinite(item.amount) && item.amount >= 0 && Number.isFinite(item.unitPrice) && item.unitPrice >= 0);
  const sum = normalized.reduce((total, item) => total + item.amount, 0);
  if (!normalized.length || !Number.isFinite(Number(totalAmount)) || Math.abs(sum - Number(totalAmount)) > 1) return [];
  return normalized.map(({ amount: _amount, ...item }) => item);
}

export function buildGranterManualTransaction({ document, expense, category, lines = [], contactId }) {
  const totalAmount = Number(expense?.total_amount);
  const transactionDate = String(expense?.transaction_date || document?.document_date || '').slice(0, 10);
  const merchantName = String(expense?.merchant_name || document?.extracted_data?.merchantName || '').trim();
  if (!Number.isInteger(Number(contactId)) || Number(contactId) <= 0) throw new Error('granter_contact_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) throw new Error('granter_transaction_date_required');
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error('granter_amount_required');
  const tradeItems = granterTradeItems(lines, totalAmount);
  return {
    contactId: Number(contactId),
    transactionType: 'OUT',
    manualTransactionType: document?.payment_method === 'cash' ? 'CASH' : 'ETC',
    transactAt: transactionDate,
    amount: Math.round(totalAmount),
    content: `${merchantName || '지출'} · Timefit 영수증`,
    currency: 'KRW',
    description: `Timefit receipt ${document.id}${expense?.reason ? ` · ${String(expense.reason).slice(0, 300)}` : ''}`,
    ...(category?.id ? { expenseCategoryId: Number(category.id) } : {}),
    ...(tradeItems.length ? { tradeItems } : {}),
  };
}

async function readPayload(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('granter_response_too_large');
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new Error('granter_response_invalid'); }
}

export async function granterRequest(path, { method = 'GET', body, idempotencyKey, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const apiKey = granterApiKey({ path, method });
  if (!apiKey) throw new Error('granter_api_key_missing');
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetchImpl(`${granterBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`,
      ...(!isForm && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, Math.min(Number(timeoutMs) || 30000, 30000))),
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const error = new Error(String(payload?.message || payload?.error || payload?.code || `granter_${response.status}`).slice(0, 500));
    error.status = response.status;
    error.code = payload?.code || null;
    error.detail = payload;
    throw error;
  }
  return { payload, revision: response.headers.get('Granter-API-Revision'), changes: response.headers.get('Granter-API-Changes') };
}

export async function loadReceiptAttachment(page) {
  const provider = String(page?.storage_provider || 'supabase');
  const sourceUrl = provider === 'google_drive'
    ? googleDriveReceiptUrl(page?.external_file_id)
    : await createTimefitAxSignedUrl(page?.storage_path, 600);
  const response = await fetch(sourceUrl, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`receipt_attachment_download_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('receipt_attachment_empty');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error('receipt_attachment_too_large');
  return {
    bytes: buffer,
    fileName: String(page?.file_name || `timefit-receipt-${page?.page_number || 1}.jpg`).slice(0, 180),
    mimeType: String(page?.mime_type || response.headers.get('content-type') || 'application/octet-stream').split(';')[0],
  };
}

export async function attachReceiptToGranter({ ticketId, page }) {
  const attachment = await loadReceiptAttachment(page);
  const form = new FormData();
  form.set('ticketId', String(ticketId));
  form.set('ticketType', 'MANUAL_TRANSACTION_TICKET');
  form.set('file', new Blob([attachment.bytes], { type: attachment.mimeType }), attachment.fileName);
  return granterRequest('/api/public-docs/tickets/attachments', { method: 'POST', body: form });
}
