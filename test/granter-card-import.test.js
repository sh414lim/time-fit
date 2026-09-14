import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGranterRows } from '../src/granterCardImport.js';

test('그랜터 계좌 엑셀에서 카드 거래만 정규화한다', () => {
  const result = normalizeGranterRows([
    { 일시: '2026-09-13T14:25:56', '계좌 이름': '국민은행3843', 사용처: '강릉상점→KB카드|체크카드', 금액: -35860, 계정과목: '상품매출원가', 거래구분: '체크카드' },
    { 일시: '2026-09-12T15:52:45', '계좌 이름': '국민은행3843', 사용처: '입금자|전자금융', 금액: 250000, 거래구분: '전자금융' },
  ]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.skipped.nonCard, 1);
  assert.equal(result.rows[0].merchantName, '강릉상점');
  assert.equal(result.rows[0].last4, '3843');
  assert.equal(result.rows[0].amount, 35860);
  assert.equal(result.rows[0].transactionType, 'approval');
});

test('그랜터 카드 입금은 취소 거래로 처리한다', () => {
  const result = normalizeGranterRows([{ 일시: '2026-09-10T10:00:00', '계좌 이름': '국민은행2169', 사용처: '환불상점→KB카드|체크카드', 금액: 12000, 거래구분: '체크카드 환불' }]);
  assert.equal(result.rows[0].transactionType, 'cancellation');
  assert.equal(result.rows[0].amount, 12000);
});

test('사용처에 카드사 이름이 있어도 전자금융 입금은 제외한다', () => {
  const result = normalizeGranterRows([{ 일시: '2026-09-11T09:26:00', '계좌 이름': '국민은행2169', 사용처: '롯데카드10040←우리은행|전자금융', 금액: 378596, 거래구분: '전자금융' }]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.skipped.nonCard, 1);
});
