import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import apiRouter from '../api/[...route].js';

const response = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  send(body) { this.body = body; return this; },
});

test('Vercel 배포 함수는 단일 통합 라우터뿐이다', () => {
  assert.deepEqual(readdirSync(new URL('../api/', import.meta.url)), ['[...route].js']);
});

test('기존 Toss Place 경로를 전달한다', async () => {
  const res = response();
  await apiRouter({ method: 'GET', query: { route: ['tossplace'] }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, service: 'timefit-tossplace-webhook' });
});

test('쿼리 경로가 없으면 URL에서 기존 경로를 읽는다', async () => {
  const res = response();
  await apiRouter({ method: 'GET', url: '/api/tossplace?health=1', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.service, 'timefit-tossplace-webhook');
});

test('알 수 없는 경로는 404를 반환한다', async () => {
  const res = response();
  await apiRouter({ method: 'GET', query: { route: ['not-found'] }, headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'API route not found');
});
