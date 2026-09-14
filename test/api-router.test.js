import test from 'node:test';
import assert from 'node:assert/strict';
import apiRouter from '../api/[...route].js';

const response = () => ({
  statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(name, value) { this.headers[name] = value; },
  send(body) { this.body = body; return this; },
});

test('통합 API 라우터가 기존 Toss Place 경로를 전달한다', async () => {
  const res = response();
  await apiRouter({ method: 'GET', query: { route: ['tossplace'] }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, service: 'timefit-tossplace-webhook' });
});

test('Vercel이 동적 쿼리를 주지 않아도 요청 URL에서 기존 경로를 전달한다', async () => {
  const res = response();
  await apiRouter({ method: 'GET', url: '/api/tossplace?health=1', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.service, 'timefit-tossplace-webhook');
});

test('통합 API 라우터가 존재하지 않는 경로를 404로 처리한다', async () => {
  const res = response();
  await apiRouter({ method: 'GET', query: { route: ['not-found'] }, headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'API route not found');
});
