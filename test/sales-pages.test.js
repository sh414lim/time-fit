import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOrderPages } from '../api/_sales-pages.js';
import { lastCompleteWeek, weeklySalesFromDaily } from '../shared/operations.js';
const order = id => ({ id, createdAt: '2026-09-01T00:00:00Z' });
test('provider pagination includes 501st order with a fixed window', async () => {
  const urls = [];
  const orders = await collectOrderPages({ url: 'https://test/orders', headers: {}, to: '2026-09-17T00:00:00Z', read: async url => {
    urls.push(new URL(url));
    return new Response(JSON.stringify({ resultType: 'SUCCESS', success: urls.length === 1 ? Array.from({ length: 500 }, (_, i) => order(i + 1)) : [order(501)] }));
  } });
  assert.equal(orders.length, 501);
  assert.deepEqual(urls.map(url => url.searchParams.get('page')), ['1', '2']);
  assert.ok(urls.every(url => url.searchParams.get('to') === '2026-09-17T00:00:00Z'));
});
test('malformed responses, deadline, and later page failures cannot return partial orders', async () => {
  await assert.rejects(collectOrderPages({ url: 'https://test', deadline: 0 }), /time limit/);
  await assert.rejects(collectOrderPages({ url: 'https://test', read: async () => new Response(JSON.stringify({ resultType: 'SUCCESS', success: {} })) }), /Invalid/);
  let pages = 0;
  await assert.rejects(collectOrderPages({ url: 'https://test', size: 1, read: async () => ++pages === 1 ? new Response(JSON.stringify({ resultType: 'SUCCESS', success: [order(1)] })) : new Response('{}', { status: 503 }) }), /503/);
});
test('zero-sales days are complete only after proven full history, not merely a recent sync', () => {
  const range = lastCompleteWeek('2026-09-17');
  const snapshot = { connection: { merchant_id: 1, last_synced_at: '2026-09-17T00:00:00Z' }, daily: [] };
  assert.equal(weeklySalesFromDaily(snapshot, range).comparable, false);
  snapshot.coveredThrough = snapshot.connection.last_synced_at;
  const result = weeklySalesFromDaily(snapshot, range);
  assert.equal(result.comparable, true); assert.equal(result.current.revenue, 0); assert.equal(result.current.average, null);
  snapshot.connection.last_error = 'failed';
  assert.equal(weeklySalesFromDaily(snapshot, range).comparable, false);
});
