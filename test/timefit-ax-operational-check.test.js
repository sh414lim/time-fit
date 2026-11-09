import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTimefitAx } from '../scripts/check-timefit-ax.mjs';

const env = { TIMEFIT_AX_URL: 'https://ax.example.com/timefit-ax', TIMEFIT_AX_ALLOWED_HOSTS: 'ax.example.com', TIMEFIT_AX_TRANSPORT_KEY: 'a'.repeat(32) };
test('AX check validates configuration before sending credentials', async () => {
  for (const change of [{ TIMEFIT_AX_URL: '' }, { TIMEFIT_AX_URL: 'http://localhost:8351' }, { TIMEFIT_AX_ALLOWED_HOSTS: 'wrong.example.com' }, { TIMEFIT_AX_TRANSPORT_KEY: 'short' }]) {
    const result = await checkTimefitAx({ env: { ...env, ...change }, fetchImpl: () => { assert.fail('must not fetch'); } });
    assert.equal(result.ok, false);
  }
});
test('AX check performs only read-only lookups with and without credentials', async () => {
  const calls = [];
  const result = await checkTimefitAx({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: calls.length === 1 ? 401 : 404 });
  } });
  assert.equal(result.code, 'TRANSPORT_OK');
  assert.equal(calls[0].url, calls[1].url);
  assert.match(calls[0].url, /^https:\/\/ax.example.com\/timefit-ax\/api\/timefit\/v1\/receipt-sessions\/healthcheck-/);
  assert.deepEqual(calls[0].options.headers, {});
  assert.equal(calls[1].options.headers['X-Timefit-Ax-Key'], env.TIMEFIT_AX_TRANSPORT_KEY);
  for (const { options } of calls) { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal); }
});
test('AX check rejects gateway errors, missing auth guard and wrong keys', async () => {
  for (const statuses of [[502], [200], [404], [401, 401], [401, 503]]) {
    const result = await checkTimefitAx({ env, fetchImpl: async () => new Response(null, { status: statuses.shift() }) });
    assert.equal(result.ok, false);
  }
});
test('AX check does not expose network error details or secrets', async () => {
  const result = await checkTimefitAx({ env, fetchImpl: async () => { throw new Error(env.TIMEFIT_AX_TRANSPORT_KEY); } });
  assert.equal(result.code, 'NETWORK');
  assert.ok(!JSON.stringify(result).includes(env.TIMEFIT_AX_TRANSPORT_KEY));
});
