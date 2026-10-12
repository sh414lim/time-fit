import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createTimefitAxServer, parseReceiptText, validateReceiptRequest } from './server.mjs';

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
  const health = await fetch(`${base}/healthz`);
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
