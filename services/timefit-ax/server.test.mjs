import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createFirestoreIdempotencyStore, createTimefitAxServer, parseReceiptText, validateReceiptRequest } from './server.mjs';

const key = 'test-key-with-at-least-thirty-two-characters';

async function withServer(analyzeImages, callback) {
  const server = createTimefitAxServer({ transportKey: key, analyzeImages });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, 'close'); }
}

const validBody = { requestId: 'receipt:document-1:run-1', organizationId: 'org-1', documentId: 'doc-1', imageUrls: ['https://example.com/receipt.jpg'] };

test('receipt text is normalized to the AX response contract', () => {
  const result = parseReceiptText('버터빌라\n2026-10-12 15:30\n사업자번호 123-45-67890\n승인번호 991122\n합계 12,300원');
  assert.equal(result.merchantName, '버터빌라');
  assert.equal(result.transactionDate, '2026-10-12');
  assert.equal(result.transactionTime, '15:30');
  assert.equal(result.totalAmount, 12300);
  assert.equal(result.merchantBusinessNumber, '123-45-67890');
  assert.equal(parseReceiptText('BUTTER VILLA\n2026-10-12\nTOTAL KRW 12,300').totalAmount, 12300);
});

test('only public HTTPS receipt URLs are accepted', () => {
  assert.throws(() => validateReceiptRequest({ ...validBody, imageUrls: ['http://127.0.0.1/a.jpg'] }), /invalid_image_url/);
  assert.throws(() => validateReceiptRequest({ ...validBody, imageUrls: [] }), /invalid_images/);
  assert.equal(validateReceiptRequest(validBody).imageUrls.length, 1);
});

test('health endpoint is public and analysis requires the shared key', async () => withServer(async () => ({}), async base => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'timefit-ax');
  const rejected = await fetch(`${base}/api/timefit/v1/receipt-sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) });
  assert.equal(rejected.status, 401);
}));

test('analysis succeeds and identical request IDs are idempotent', async () => {
  let calls = 0;
  await withServer(async () => {
    calls += 1;
    return { extraction: { merchantName: '버터빌라', transactionDate: '2026-10-12', totalAmount: 12300 }, imageContentSha256: 'abc', model: 'test' };
  }, async base => {
    const request = () => fetch(`${base}/api/timefit/v1/receipt-sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timefit-Ax-Key': key }, body: JSON.stringify(validBody) });
    const first = await request(); const second = await request();
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal((await first.json()).state, 'SUCCEEDED');
    assert.equal(calls, 1);
  });
});

test('a reused request ID with different input is rejected', async () => withServer(async () => ({ extraction: {}, imageContentSha256: 'abc', model: 'test' }), async base => {
  const send = body => fetch(`${base}/api/timefit/v1/receipt-sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timefit-Ax-Key': key }, body: JSON.stringify(body) });
  assert.equal((await send(validBody)).status, 200);
  assert.equal((await send({ ...validBody, documentId: 'doc-2' })).status, 409);
}));

function fakeFirestore() {
  let document = null;
  let version = 0;
  const response = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'POST') {
      if (document) return response(409, { error: { status: 'ALREADY_EXISTS' } });
      version += 1;
      document = { ...JSON.parse(options.body), updateTime: `2026-10-12T00:00:0${version}Z` };
      return response(200, document);
    }
    if (method === 'GET') return document ? response(200, document) : response(404, {});
    const expected = new URL(url).searchParams.get('currentDocument.updateTime');
    if (!document || expected !== document.updateTime) return response(409, {});
    if (method === 'DELETE') { document = null; return response(200, {}); }
    if (method === 'PATCH') {
      version += 1;
      document = { fields: { ...document.fields, ...JSON.parse(options.body).fields }, updateTime: `2026-10-12T00:00:0${version}Z` };
      return response(200, document);
    }
    return response(405, {});
  };
}

test('Firestore idempotency is shared, caches success, and rejects conflicts', async () => {
  const store = createFirestoreIdempotencyStore({ tokenProvider: async () => 'token', fetchImpl: fakeFirestore(), now: () => Date.parse('2026-10-12T00:00:00Z') });
  const input = { requestId: 'receipt:firestore:shared', fingerprint: 'fingerprint-a' };
  const first = await store.claim(input);
  assert.equal(first.state, 'claimed');
  assert.equal((await store.claim(input)).state, 'pending');
  const payload = { requestId: input.requestId, state: 'SUCCEEDED', extraction: { totalAmount: 12300 } };
  await store.complete({ ...input, ...first, payload });
  assert.deepEqual(await store.claim(input), { state: 'cached', payload });
  assert.equal((await store.claim({ ...input, fingerprint: 'fingerprint-b' })).state, 'conflict');
});

test('Firestore idempotency recovers an expired pending lease', async () => {
  let clock = Date.parse('2026-10-12T00:00:00Z');
  const store = createFirestoreIdempotencyStore({ tokenProvider: async () => 'token', fetchImpl: fakeFirestore(), now: () => clock });
  const input = { requestId: 'receipt:firestore:stale', fingerprint: 'fingerprint-a' };
  assert.equal((await store.claim(input)).state, 'claimed');
  clock += 3 * 60 * 1000;
  assert.equal((await store.claim(input)).state, 'claimed');
});
