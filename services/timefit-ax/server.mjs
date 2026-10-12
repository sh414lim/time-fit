import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 20;
const MAX_CACHE_ENTRIES = 500;
const IDEMPOTENCY_COLLECTION = 'timefit_ax_idempotency';
const IDEMPOTENCY_LEASE_MS = 2 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_ID = /^[A-Za-z0-9:_-]{8,200}$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'application/pdf']);

const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
};

const safeEqual = (actual, expected) => {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
};

const privateIp = address => {
  if (!net.isIP(address)) return true;
  if (address === '::1' || address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return address.startsWith('::ffff:') && privateIp(address.slice(7));
};

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('request_too_large'), { status: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch { reject(Object.assign(new Error('invalid_json'), { status: 400 })); }
  });
  req.on('error', reject);
});

export function validateReceiptRequest(body) {
  const requestId = String(body?.requestId || '');
  const organizationId = String(body?.organizationId || '');
  const documentId = String(body?.documentId || '');
  const imageUrls = Array.isArray(body?.imageUrls) ? body.imageUrls.map(value => String(value || '')) : [];
  if (!REQUEST_ID.test(requestId)) throw Object.assign(new Error('invalid_request_id'), { status: 400 });
  if (!organizationId || organizationId.length > 200 || !documentId || documentId.length > 200) throw Object.assign(new Error('invalid_document'), { status: 400 });
  if (!imageUrls.length || imageUrls.length > MAX_IMAGES) throw Object.assign(new Error('invalid_images'), { status: 400 });
  for (const value of imageUrls) {
    if (!value || value.length > 4096) throw Object.assign(new Error('invalid_image_url'), { status: 400 });
    let parsed;
    try { parsed = new URL(value); } catch { throw Object.assign(new Error('invalid_image_url'), { status: 400 }); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw Object.assign(new Error('invalid_image_url'), { status: 400 });
  }
  return { requestId, organizationId, documentId, imageUrls };
}

async function publicAddresses(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => privateIp(item.address))) throw Object.assign(new Error('image_host_not_public'), { status: 400 });
  return addresses;
}

export async function downloadImage(value) {
  const url = new URL(value);
  const addresses = await publicAddresses(url.hostname);
  const allowed = new Set(addresses.map(item => item.address));
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({
      keepAlive: false,
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { all: true, verbatim: true }).then(current => {
          if (!current.length || current.some(item => privateIp(item.address) || !allowed.has(item.address))) return callback(Object.assign(new Error('image_dns_changed'), { status: 400 }));
          if (options?.all) callback(null, current);
          else callback(null, current[0].address, current[0].family);
        }, callback);
      },
    });
    const request = https.request(url, { method: 'GET', agent, timeout: 12_000, headers: { Accept: 'image/*,application/pdf;q=0.5', 'User-Agent': 'Timefit-AX/1.0' } }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) { response.resume(); return reject(Object.assign(new Error('image_redirect_rejected'), { status: 400 })); }
      if (status !== 200) { response.resume(); return reject(Object.assign(new Error(`image_download_${status}`), { status: 422 })); }
      const contentType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (!IMAGE_TYPES.has(contentType)) { response.resume(); return reject(Object.assign(new Error('image_content_type_rejected'), { status: 415 })); }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_IMAGE_BYTES) { response.resume(); return reject(Object.assign(new Error('image_too_large'), { status: 413 })); }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) return response.destroy(Object.assign(new Error('image_too_large'), { status: 413 }));
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ content: Buffer.concat(chunks), contentType }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('image_download_timeout'), { status: 504 })));
    request.on('error', reject);
    request.end();
  });
}

let accessTokenCache = null;

async function metadataAccessToken() {
  if (accessTokenCache?.expiresAt > Date.now() + 60_000) return accessTokenCache.value;
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw Object.assign(new Error('google_auth_unavailable'), { status: 503 });
  const body = await response.json();
  if (!body.access_token) throw Object.assign(new Error('google_auth_unavailable'), { status: 503 });
  accessTokenCache = { value: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 300)) * 1000 };
  return body.access_token;
}

export async function visionAnnotations(images) {
  const token = await metadataAccessToken();
  const response = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': process.env.GOOGLE_CLOUD_PROJECT || 'team-bro' },
    body: JSON.stringify({ requests: images.map(image => ({ image: { content: image.content.toString('base64') }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] })) }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error?.message || `google_vision_${response.status}`), { status: 502 });
  if (body.responses?.some(item => item.error)) throw Object.assign(new Error(body.responses.find(item => item.error)?.error?.message || 'google_vision_failed'), { status: 502 });
  return body.responses || [];
}

const numberValue = value => {
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '').replace(/[,.](?=\d{3}(?:\D|$))/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
};

export function parseReceiptText(rawText) {
  const text = String(rawText || '');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const dateMatch = text.match(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);
  const timeMatch = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\s|$)/m);
  const business = text.match(/(?:사업자(?:등록)?번호|사업자)\s*[:：]?\s*(\d{3})[- ]?(\d{2})[- ]?(\d{5})/i);
  const approval = text.match(/(?:승인번호|승인\s*No\.?)\s*[:：]?\s*([0-9A-Za-z-]{4,})/i);
  const card = text.match(/(?:카드번호|카드)\s*[:：]?\s*(?:[*Xx#-]+\s*)?(\d{4})(?!\d)/i);
  const labelled = [...text.matchAll(/(?:금일\s*매출액|결제금액|받을금액|총\s*금액|총액|합\s*계|total(?:\s*amount)?|amount)\s*[:：]?\s*(?:KRW\s*)?[₩￦]?\s*([0-9][0-9,.]*)/gi)].map(match => numberValue(match[1])).filter(value => Number.isFinite(value) && value > 0);
  const currency = [...text.matchAll(/[₩￦]\s*([0-9][0-9,.]*)/g)].map(match => numberValue(match[1])).filter(value => Number.isFinite(value) && value > 0);
  const totalAmount = labelled.at(-1) || (currency.length ? Math.max(...currency) : null);
  const merchantName = lines.find(line => !/영수증|매출전표|거래\s*명세서|사업자|대표|전화|주소|카드번호|승인번호/i.test(line) && /[가-힣A-Za-z]/.test(line)) || null;
  const transactionDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}` : null;
  const missing = [!merchantName && 'merchant_name', !transactionDate && 'transaction_date', !totalAmount && 'total_amount'].filter(Boolean);
  return {
    documentType: 'receipt', merchantName,
    merchantBusinessNumber: business ? `${business[1]}-${business[2]}-${business[3]}` : null,
    transactionDate, transactionTime: timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null,
    totalAmount, supplyAmount: null, vatAmount: null,
    approvalNumber: approval?.[1] || null, cardLast4: card?.[1] || null,
    currency: 'KRW', paymentMethod: card ? 'corporate_card' : null,
    rawText: text.slice(0, 100_000), lineItems: [],
    confidence: missing.length ? 0.58 : 0.86,
    fieldConfidence: { merchantName: merchantName ? 0.72 : 0, transactionDate: transactionDate ? 0.9 : 0, totalAmount: totalAmount ? 0.85 : 0 },
    warnings: missing.map(field => `missing_${field}`),
  };
}

export async function analyzeReceiptImages(imageUrls) {
  const images = [];
  for (const value of imageUrls) images.push(await downloadImage(value));
  const responses = await visionAnnotations(images);
  const rawText = responses.map(item => item.fullTextAnnotation?.text || item.textAnnotations?.[0]?.description || '').filter(Boolean).join('\n\n--- page ---\n\n');
  if (!rawText.trim()) throw Object.assign(new Error('receipt_text_not_found'), { status: 422 });
  return {
    extraction: parseReceiptText(rawText),
    imageContentSha256: createHash('sha256').update(Buffer.concat(images.map(item => item.content))).digest('hex'),
    model: 'google-cloud-vision-document-text-detection',
  };
}

export function createMemoryIdempotencyStore() {
  const cache = new Map();
  const pending = new Map();
  const remember = (key, value) => {
    cache.set(key, value);
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  };
  return {
    async claim({ requestId, fingerprint }) {
      const known = cache.get(requestId);
      if (known?.fingerprint !== undefined && known.fingerprint !== fingerprint) return { state: 'conflict' };
      if (known) return { state: 'cached', payload: known.payload };
      if (pending.has(requestId)) return { state: 'pending' };
      const owner = randomUUID();
      pending.set(requestId, { fingerprint, owner });
      return { state: 'claimed', owner };
    },
    async complete({ requestId, fingerprint, owner, payload }) {
      const active = pending.get(requestId);
      if (!active || active.fingerprint !== fingerprint || active.owner !== owner) throw Object.assign(new Error('idempotency_claim_lost'), { status: 503 });
      remember(requestId, { fingerprint, payload });
      pending.delete(requestId);
    },
    async release({ requestId, owner }) {
      if (pending.get(requestId)?.owner === owner) pending.delete(requestId);
    },
  };
}

const firestoreValue = (fields, name) => {
  const value = fields?.[name];
  return value?.stringValue ?? value?.timestampValue ?? null;
};

export function createFirestoreIdempotencyStore({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || 'team-bro',
  tokenProvider = metadataAccessToken,
  fetchImpl = fetch,
  now = () => Date.now(),
} = {}) {
  const documentsUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${IDEMPOTENCY_COLLECTION}`;
  const call = async (url, options = {}) => {
    const token = await tokenProvider();
    const response = await fetchImpl(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: options.signal || AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    return { response, body };
  };
  const unavailable = code => Object.assign(new Error(code), { status: 503 });
  const documentUrl = requestId => `${documentsUrl}/${createHash('sha256').update(requestId).digest('hex')}`;
  const pendingDocument = ({ requestId, fingerprint, owner }) => ({
    fields: {
      requestId: { stringValue: requestId }, fingerprint: { stringValue: fingerprint }, owner: { stringValue: owner }, state: { stringValue: 'PENDING' },
      leaseExpiresAt: { timestampValue: new Date(now() + IDEMPOTENCY_LEASE_MS).toISOString() },
      expireAt: { timestampValue: new Date(now() + IDEMPOTENCY_TTL_MS).toISOString() },
    },
  });

  const claim = async ({ requestId, fingerprint }, retry = true) => {
    const owner = randomUUID();
    const id = createHash('sha256').update(requestId).digest('hex');
    const created = await call(`${documentsUrl}?documentId=${id}`, { method: 'POST', body: JSON.stringify(pendingDocument({ requestId, fingerprint, owner })) });
    if (created.response.status === 200) return { state: 'claimed', owner, updateTime: created.body.updateTime };
    if (created.response.status !== 409) throw unavailable(`idempotency_store_create_${created.response.status}`);

    const existing = await call(documentUrl(requestId));
    if (!existing.response.ok) throw unavailable(`idempotency_store_read_${existing.response.status}`);
    const fields = existing.body.fields || {};
    if (firestoreValue(fields, 'fingerprint') !== fingerprint) return { state: 'conflict' };
    const state = firestoreValue(fields, 'state');
    if (state === 'SUCCEEDED') {
      try { return { state: 'cached', payload: JSON.parse(firestoreValue(fields, 'payloadJson') || '') }; }
      catch { throw unavailable('idempotency_store_payload_invalid'); }
    }
    const leaseExpiresAt = Date.parse(firestoreValue(fields, 'leaseExpiresAt') || '');
    if (state === 'PENDING' && Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now()) return { state: 'pending' };
    if (!retry || !existing.body.updateTime) throw unavailable('idempotency_store_stale_claim');

    const removed = await call(`${documentUrl(requestId)}?currentDocument.updateTime=${encodeURIComponent(existing.body.updateTime)}`, { method: 'DELETE' });
    if (![200, 404].includes(removed.response.status)) return { state: 'pending' };
    return claim({ requestId, fingerprint }, false);
  };

  return {
    claim,
    async complete({ requestId, owner, updateTime, payload }) {
      const query = new URLSearchParams();
      for (const field of ['state', 'payloadJson', 'expireAt']) query.append('updateMask.fieldPaths', field);
      query.set('currentDocument.updateTime', updateTime);
      const completed = await call(`${documentUrl(requestId)}?${query}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: {
          state: { stringValue: 'SUCCEEDED' }, payloadJson: { stringValue: JSON.stringify(payload) },
          expireAt: { timestampValue: new Date(now() + IDEMPOTENCY_TTL_MS).toISOString() },
        } }),
      });
      if (!completed.response.ok || firestoreValue(completed.body.fields, 'state') !== 'SUCCEEDED') throw unavailable(`idempotency_store_complete_${completed.response.status}`);
      if (firestoreValue(completed.body.fields, 'payloadJson') !== JSON.stringify(payload)) throw unavailable('idempotency_store_complete_invalid');
      if (firestoreValue(completed.body.fields, 'owner') && firestoreValue(completed.body.fields, 'owner') !== owner) throw unavailable('idempotency_claim_lost');
    },
    async release({ requestId, updateTime }) {
      if (!updateTime) return;
      const removed = await call(`${documentUrl(requestId)}?currentDocument.updateTime=${encodeURIComponent(updateTime)}`, { method: 'DELETE' });
      if (![200, 404, 409].includes(removed.response.status)) throw unavailable(`idempotency_store_release_${removed.response.status}`);
    },
  };
}

function defaultIdempotencyStore() {
  return process.env.TIMEFIT_AX_IDEMPOTENCY_BACKEND === 'firestore' ? createFirestoreIdempotencyStore() : createMemoryIdempotencyStore();
}

export function createTimefitAxServer({ transportKey = process.env.TIMEFIT_AX_TRANSPORT_KEY, analyzeImages = analyzeReceiptImages, idempotencyStore = defaultIdempotencyStore() } = {}) {
  if (!transportKey || transportKey.length < 32) throw new Error('TIMEFIT_AX_TRANSPORT_KEY must contain at least 32 characters');
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) return json(res, 200, { ok: true, service: 'timefit-ax', provider: 'google_cloud_vision' });
    if (req.method !== 'POST' || req.url !== '/api/timefit/v1/receipt-sessions') return json(res, 404, { state: 'FAILED', errorCode: 'not_found' });
    if (!safeEqual(req.headers['x-timefit-ax-key'], transportKey)) return json(res, 401, { state: 'FAILED', errorCode: 'unauthorized' });
    let claim;
    let input;
    let fingerprint;
    try {
      input = validateReceiptRequest(await readBody(req));
      fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      claim = await idempotencyStore.claim({ requestId: input.requestId, fingerprint });
      if (claim.state === 'conflict') return json(res, 409, { state: 'FAILED', errorCode: 'request_id_conflict' });
      if (claim.state === 'cached') return json(res, 200, claim.payload);
      if (claim.state === 'pending') return json(res, 409, { state: 'FAILED', errorCode: 'request_in_progress' });
      if (claim.state !== 'claimed') throw Object.assign(new Error('idempotency_store_invalid'), { status: 503 });
      const result = await analyzeImages(input.imageUrls);
      const payload = { requestId: input.requestId, state: 'SUCCEEDED', extraction: result.extraction, imageContentSha256: result.imageContentSha256, model: result.model };
      await idempotencyStore.complete({ requestId: input.requestId, fingerprint, owner: claim.owner, updateTime: claim.updateTime, payload });
      console.info('timefit_ax_succeeded', { requestId: input.requestId, organizationId: input.organizationId, documentId: input.documentId, imageCount: input.imageUrls.length });
      return json(res, 200, payload);
    } catch (error) {
      if (claim?.state === 'claimed' && input?.requestId) {
        await idempotencyStore.release({ requestId: input.requestId, fingerprint, owner: claim.owner, updateTime: claim.updateTime }).catch(releaseError => {
          console.error('timefit_ax_idempotency_release_failed', { code: String(releaseError.message || 'release_failed').slice(0, 160) });
        });
      }
      const status = Number(error.status || 500);
      const code = String(error.message || 'analysis_failed').slice(0, 160);
      console.error('timefit_ax_failed', { status, code });
      return json(res, status >= 400 && status <= 599 ? status : 500, { state: 'FAILED', errorCode: code, error: status >= 500 ? '영수증 분석을 완료하지 못했습니다.' : code });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  createTimefitAxServer().listen(port, '0.0.0.0', () => console.info('timefit_ax_listening', { port }));
}
