import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { serviceHeaders } from './_finance-server.js';
import { validateReceiptExtraction } from './_receipt-extraction.js';

const STORAGE_BUCKET = 'timefit-finance-documents';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MAX_AX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,100}$/;
const hostList = value => new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));

function isPrivateIp(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host)) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.includes(':')) return /^(fc|fd|fe8|fe9|fea|feb)/i.test(host);
  const [a, b] = host.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function axBaseUrl({ value = process.env.TIMEFIT_AX_URL, nodeEnv = process.env.NODE_ENV, allowedHosts = process.env.TIMEFIT_AX_ALLOWED_HOSTS } = {}) {
  const raw = String(value || (nodeEnv === 'production' ? '' : 'http://127.0.0.1:8351')).trim().replace(/\/$/, '');
  if (!raw) throw new Error('timefit_ax_url_required');
  const url = new URL(raw);
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.username || url.password || url.search || url.hash) throw new Error('timefit_ax_url_invalid');
  if (loopback) {
    if (nodeEnv === 'production' || url.protocol !== 'http:') throw new Error('timefit_ax_loopback_development_only');
  } else {
    if (url.protocol !== 'https:' || isPrivateIp(url.hostname)) throw new Error('timefit_ax_https_required');
    const hosts = hostList(allowedHosts);
    if (!hosts.size || !hosts.has(url.hostname.toLowerCase())) throw new Error('timefit_ax_host_not_allowed');
  }
  return url.toString().replace(/\/$/, '');
}

export const resolveTimefitAxUrl = () => axBaseUrl();

export function normalizeImageUrls(input, { nodeEnv = process.env.NODE_ENV } = {}) {
  const values = Array.isArray(input?.imageUrls) ? input.imageUrls : input?.imageUrl ? [input.imageUrl] : [];
  if (!values.length || values.length > 20) throw new Error('receipt_image_urls_invalid');
  return values.map(value => {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 4096) throw new Error('receipt_image_url_invalid');
    let url;
    try { url = new URL(raw); } catch { throw new Error('receipt_image_url_invalid'); }
    const loopback = LOOPBACK_HOSTS.has(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(nodeEnv !== 'production' && loopback && url.protocol === 'http:')) || (!loopback && isPrivateIp(url.hostname))) throw new Error('receipt_image_url_unsafe');
    return url.toString();
  });
}

export function normalizedRequestId(value, documentId) {
  const requestId = String(value || `receipt:${documentId}:${randomUUID()}`);
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new Error('timefit_ax_request_id_invalid');
  return requestId;
}

export function axTimeout(value = process.env.TIMEFIT_AX_REQUEST_TIMEOUT_MS) {
  const timeout = Number(value || 55000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 55000) throw new Error('timefit_ax_timeout_invalid');
  return timeout;
}

export function timefitAxConfigured() {
  return Boolean(process.env.TIMEFIT_AX_URL && process.env.TIMEFIT_AX_ALLOWED_HOSTS && process.env.TIMEFIT_AX_TRANSPORT_KEY?.length >= 32);
}

export function encodedStoragePath(path, { supabaseUrl = process.env.SUPABASE_URL } = {}) {
  let value = String(path || '').trim().replace(/\\/g, '/');
  let isEncodedUrlPath = false;
  if (/^https?:\/\//i.test(value)) {
    if (/(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|%2f|$)/i.test(value)) throw new Error('timefit_ax_storage_path_invalid');
    let url;
    try { url = new URL(value); } catch { throw new Error('timefit_ax_storage_path_invalid'); }
    let expectedOrigin;
    try { expectedOrigin = new URL(String(supabaseUrl || '')).origin; } catch { throw new Error('timefit_ax_storage_path_invalid'); }
    if (url.origin !== expectedOrigin) throw new Error('timefit_ax_storage_path_invalid');
    const prefix = new RegExp(`^/storage/v1/object/(?:authenticated|public|sign)/${STORAGE_BUCKET}/`);
    const match = url.pathname.match(prefix);
    if (!match) throw new Error('timefit_ax_storage_path_invalid');
    value = url.pathname.slice(match[0].length);
    isEncodedUrlPath = true;
  }
  value = value.replace(/^\/+/, '');
  if (value.startsWith(`${STORAGE_BUCKET}/`)) value = value.slice(STORAGE_BUCKET.length + 1);
  let parts = value.split('/').filter(Boolean);
  if (isEncodedUrlPath) {
    try { parts = parts.map(part => decodeURIComponent(part)); } catch { throw new Error('timefit_ax_storage_path_invalid'); }
  }
  if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error('timefit_ax_storage_path_invalid');
  if (parts.some(part => part.includes('/') || part.includes('\\'))) throw new Error('timefit_ax_storage_path_invalid');
  return parts.map(encodeURIComponent).join('/');
}

export function receiptSourcePages(document, pages = []) {
  const sourcePages = Array.isArray(pages) && pages.length
    ? pages
    : [{ ...document, page_number: 1 }];
  return sourcePages.map((page, index) => {
    const pageNumber = Number(page?.page_number || index + 1);
    const storageProvider = String(page?.storage_provider || document?.storage_provider || 'supabase');
    const storagePath = String(page?.storage_path || '').trim()
      || (pageNumber === 1 ? String(document?.storage_path || '').trim() : '');
    const externalFileId = String(page?.external_file_id || '').trim()
      || (pageNumber === 1 ? String(document?.external_file_id || '').trim() : '');
    const externalUrl = String(page?.external_url || '').trim()
      || (pageNumber === 1 ? String(document?.external_url || '').trim() : '');
    if (storageProvider === 'google_drive') {
      if (!externalFileId) throw new Error('receipt_drive_file_id_missing');
    } else if (!storagePath) throw new Error('receipt_storage_path_missing');
    return {
      ...page,
      storage_provider: storageProvider,
      storage_path: storagePath || null,
      external_file_id: externalFileId || null,
      external_url: externalUrl || null,
      mime_type: page?.mime_type || document?.mime_type || null,
    };
  });
}

export function googleDriveReceiptUrl(fileId) {
  const value = String(fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(value)) throw new Error('receipt_drive_file_id_invalid');
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(value)}&export=download`;
}

function absoluteSignedUrl(value) {
  const signed = String(value || '');
  if (!signed) throw new Error('timefit_ax_signed_url_missing');
  if (/^https:\/\//i.test(signed)) return signed;
  const path = signed.startsWith('/storage/v1/') ? signed : signed.startsWith('/object/') ? `/storage/v1${signed}` : `/storage/v1/${signed.replace(/^\/+/, '')}`;
  return new URL(path, `${process.env.SUPABASE_URL}/`).toString();
}

export async function createTimefitAxSignedUrl(storagePath, expiresIn = 600) {
  let normalizedPath;
  try {
    normalizedPath = encodedStoragePath(storagePath);
  } catch (error) {
    const raw = String(storagePath || '').trim();
    let parsed = null;
    try { parsed = /^https?:\/\//i.test(raw) ? new URL(raw) : null; } catch { parsed = null; }
    console.error('Timefit AX storage path rejected', {
      empty: !raw,
      length: raw.length,
      isUrl: /^https?:\/\//i.test(raw),
      hostname: parsed?.hostname || null,
      pathnameRoot: parsed ? parsed.pathname.split('/').slice(0, 6).join('/') : null,
      segmentCount: raw.replace(/^\/+/, '').split('/').filter(Boolean).length,
      startsWithBucket: raw.replace(/^\/+/, '').startsWith(`${STORAGE_BUCKET}/`),
    });
    throw error;
  }
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/sign/${STORAGE_BUCKET}/${normalizedPath}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ expiresIn }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`timefit_ax_sign_${response.status}`);
  return absoluteSignedUrl(payload.signedURL || payload.signedUrl);
}

export function normalizeTimefitAxExtraction(value = {}) {
  const confidence = Math.max(0, Math.min(1, Number(value.confidence) || 0));
  const normalized = validateReceiptExtraction({
    merchantName: value.merchantName,
    transactionDate: value.transactionDate,
    transactionTime: value.transactionTime,
    totalAmount: value.totalAmount,
    supplyAmount: null,
    vatAmount: null,
    taxFreeAmount: null,
    merchantBusinessNumber: value.merchantBusinessNumber,
    approvalNumber: value.approvalNumber,
    cardLast4: value.cardLast4,
    paymentMethod: null,
    category: null,
    confidence,
    fieldConfidence: {
      merchantName: confidence,
      transactionDate: confidence,
      totalAmount: confidence,
      paymentMethod: 0,
    },
    lineItems: (Array.isArray(value.lineItems) ? value.lineItems : []).map(item => ({
      rawText: String(item?.name || ''),
      itemName: item?.name,
      quantity: item?.quantity,
      unit: null,
      unitPrice: item?.unitPrice,
      discountAmount: 0,
      lineAmount: item?.amount,
      taxType: 'unknown',
      confidence,
    })),
  });
  return {
    ...normalized,
    documentType: value.documentType || 'unknown',
    currency: value.currency || 'UNKNOWN',
    warnings: Array.isArray(value.warnings) ? value.warnings.map(item => String(item)).slice(0, 20) : [],
    extractionProvider: 'timefit_ax_codex',
  };
}

async function readAxPayload(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_AX_RESPONSE_BYTES) throw new Error('timefit_ax_response_too_large');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_AX_RESPONSE_BYTES) throw new Error('timefit_ax_response_too_large');
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error('timefit_ax_response_invalid'); }
}

export async function extractReceiptWithTimefitAx({ organizationId, documentId, runId, requestId: suppliedRequestId, storagePaths, sources }) {
  if (!timefitAxConfigured()) throw new Error('timefit_ax_not_configured');
  const sourceItems = Array.isArray(sources)
    ? sources
    : Array.isArray(storagePaths) ? storagePaths.map(storagePath => ({ storage_provider: 'supabase', storage_path: storagePath })) : [];
  if (!sourceItems.length || sourceItems.length > 20) throw new Error('timefit_ax_images_invalid');
  const imageUrls = [];
  for (const source of sourceItems) {
    imageUrls.push(source?.storage_provider === 'google_drive'
      ? googleDriveReceiptUrl(source.external_file_id)
      : await createTimefitAxSignedUrl(source?.storage_path));
  }
  const requestId = normalizedRequestId(suppliedRequestId || `receipt:${documentId}:${runId}`, documentId);
  const response = await fetch(`${resolveTimefitAxUrl()}/api/timefit/v1/receipt-sessions`, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Timefit-Ax-Key': process.env.TIMEFIT_AX_TRANSPORT_KEY },
    body: JSON.stringify({ requestId, organizationId, documentId, imageUrls }),
    signal: AbortSignal.timeout(axTimeout()),
  });
  const payload = await readAxPayload(response);
  if (!response.ok || payload.state !== 'SUCCEEDED' || !payload.extraction) {
    throw new Error(String(payload.error || payload.errorCode || `timefit_ax_${response.status}`).slice(0, 300));
  }
  return {
    requestId,
    rawText: String(payload.extraction.rawText || ''),
    extracted: normalizeTimefitAxExtraction(payload.extraction),
    imageContentSha256: payload.imageContentSha256 || null,
    model: 'codex-cli',
  };
}
