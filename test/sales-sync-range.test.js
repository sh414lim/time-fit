import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySalesSyncRange, normalizeSalesSyncRange } from '../server/api/sync-sales.js';

test('월 매출 동기화 기간을 한국 시간 기준 Toss API 범위로 변환한다', () => {
  assert.deepEqual(normalizeSalesSyncRange('2026-09-01', '2026-09-30'), {
    from: '2026-08-31T15:00:00.000Z',
    to: '2026-09-30T14:59:59.999Z',
  });
});

test('오후 10시 자동 매출 수집은 한국시간 전일 0시부터 당일 22시까지 재조회한다', () => {
  const range = dailySalesSyncRange(new Date('2026-09-15T13:00:00.000Z'));
  assert.deepEqual(range, { from: '2026-09-13T15:00:00.000Z', to: '2026-09-15T13:00:00.000Z' });
  assert.deepEqual(dailySalesSyncRange(new Date('2026-09-15T13:27:00.000Z')), range);
});

test('불완전하거나 역전된 동기화 기간을 거부한다', () => {
  assert.throws(() => normalizeSalesSyncRange('2026-09-01', null), /시작일과 종료일/);
  assert.throws(() => normalizeSalesSyncRange('2026-10-01', '2026-09-30'), /기간을 확인/);
});
