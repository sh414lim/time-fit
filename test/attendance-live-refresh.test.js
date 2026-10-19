import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('출퇴근 화면은 QR 기록을 열린 화면에서도 주기적으로 갱신한다', () => {
  assert.match(main, /window\.setInterval\(refreshWhenVisible,15000\)/);
  assert.match(main, /window\.addEventListener\('focus',refreshWhenVisible\)/);
  assert.match(main, /document\.addEventListener\('visibilitychange',refreshWhenVisible\)/);
  assert.match(main, /onRefresh=\{refreshWorkforceInPlace\}/);
});

test('관리자가 즉시 최신 출퇴근 기록을 요청할 수 있다', () => {
  assert.match(main, /↻ 최신 기록/);
  assert.match(main, /onClick=\{\(\)=>void refreshAttendance\(\)\}/);
});
