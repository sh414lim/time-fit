import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, {
  dailyWorkerIdentityHmac,
  normalizeKoreanMobile,
  normalizeResidentRegistrationNumber,
} from '../server/api/daily-worker-attendance.js';

const requestKey = '123e4567-e89b-42d3-a456-426614174000';
const deviceToken = 'tablet-device-token-with-enough-length';

function configure() {
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('단기직원 전화번호와 주민번호를 서버 표준 형식으로 정규화한다', () => {
  assert.deepEqual(normalizeKoreanMobile('010-1234-5678'), {
    e164: '+821012345678', digits: '01012345678', last4: '5678', last8: '12345678',
  });
  assert.deepEqual(normalizeResidentRegistrationNumber('900101-1234567'), {
    digits: '9001011234567', mask: '900101-1******',
  });
  assert.throws(
    () => normalizeResidentRegistrationNumber('901332-1234567'),
    /daily_worker_invalid_resident/,
  );
});

test('식별 HMAC는 결정적이고 원문을 노출하지 않는다', () => {
  configure();
  const first = dailyWorkerIdentityHmac('+821012345678');
  assert.equal(first, dailyWorkerIdentityHmac('+821012345678'));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, '+821012345678');
});

test('출근 API는 주민번호를 암호화하고 service-role RPC만 호출한다', async t => {
  configure();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ action: 'check_in', employeeName: '테스트직원' });
  });
  const res = responseRecorder();
  await handler({ method: 'POST', body: {
    action: 'check_in', deviceToken, requestKey, name: '테스트직원',
    phone: '01012345678', residentRegistrationNumber: '9001011234567',
    privacyConsent: true,
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /timefit_user_daily_worker_check_in$/);
  const rpc = JSON.parse(calls[0].options.body);
  assert.equal(rpc.p_resident_ciphertext.includes('9001011234567'), false);
  assert.match(rpc.p_resident_hmac, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(res.body).includes('9001011234567'), false);
});

test('태블릿 앱과 API 라우터에 단기직원 흐름이 연결된다', () => {
  const app = readFileSync(new URL('../tablet_app/lib/main.dart', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../server/routes/operations.js', import.meta.url), 'utf8');
  assert.match(app, /Text\('단기직원'\)/);
  assert.match(app, /_dailyWorkerPanel/);
  assert.match(app, /\/api\/daily-worker-attendance/);
  assert.match(app, /개인정보 수집·이용에 동의합니다/);
  assert.match(routes, /'daily-worker-attendance': dailyWorkerAttendance/);
});
