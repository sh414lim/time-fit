import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../server/api/short-term-worker-details.js';

const responseRecorder = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('단기직원 상세 API는 인증과 사업장 식별자를 요구한다', async () => {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
  const res = responseRecorder();
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
});

test('관리자 웹은 전체 전화번호 목록과 주민번호 상세 조회를 제공한다', () => {
  const app = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261019000400_short_term_worker_encrypted_phone.sql', import.meta.url), 'utf8');
  assert.match(app, /단기직원 상세/);
  assert.match(app, /resident_registration_number/);
  assert.match(app, /record\.phone_number/);
  assert.match(client, /short-term-worker-details/);
  assert.match(migration, /encrypted_phone_number/);
});
