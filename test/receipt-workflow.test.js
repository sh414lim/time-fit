import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionReceiptReview, receiptPriority, receiptValidation } from '../server/domain/receipt-validation.js';
import { isReceiptRunStale, matchScore } from '../server/api/receipt-process.js';

test('영수증 필수값과 품목 합계를 제출자 확인 대상으로 분류한다', () => {
  const missing = receiptValidation({ transactionDate: '2026-09-23', totalAmount: 12000 });
  assert.equal(missing.validForManagerReview, false);
  assert.equal(missing.requiresSubmitterReview, true);
  assert.ok(missing.issues.some(issue => issue.code === 'merchant_missing'));

  const mismatch = receiptValidation({
    merchantName: '테스트상회', transactionDate: '2026-09-23', totalAmount: 12000,
    lineItems: [{ lineAmount: 5000 }, { lineAmount: 6000 }],
  });
  assert.equal(mismatch.validForManagerReview, true);
  assert.equal(mismatch.lineItemDifference, 1000);
  assert.ok(mismatch.issues.some(issue => issue.code === 'line_item_total_mismatch'));
});

test('영수증 검토 상태는 허용된 방향으로만 전환한다', () => {
  assert.equal(canTransitionReceiptReview('manager_review', 'change_requested'), true);
  assert.equal(canTransitionReceiptReview('change_requested', 'resubmitted'), true);
  assert.equal(canTransitionReceiptReview('approved', 'manager_review'), false);
  assert.equal(canTransitionReceiptReview('submitted', 'approved'), false);
});

test('분석 실패와 수정 요청을 일반 검토보다 먼저 보여준다', () => {
  const now = Date.parse('2026-09-23T00:00:00Z');
  const failed = receiptPriority({ reviewStatus: 'submitter_review', processingStatus: 'failed', createdAt: '2026-09-22', totalAmount: 1000 }, now);
  const change = receiptPriority({ reviewStatus: 'change_requested', processingStatus: 'ready', createdAt: '2026-09-22', totalAmount: 1000 }, now);
  const normal = receiptPriority({ reviewStatus: 'manager_review', processingStatus: 'ready', createdAt: '2026-09-20', totalAmount: 100000 }, now);
  assert.ok(failed.score > normal.score);
  assert.ok(change.score > normal.score);
});

test('매칭 문맥 점수는 총 100점을 넘지 않는다', () => {
  const result = matchScore(
    { merchantName: '테스트상회', transactionDate: '2026-09-23', transactionTime: '12:00', totalAmount: 12000, approvalNumber: 'A1', cardLast4: '1234' },
    { merchant_name: '테스트상회 강남점', approved_at: '2026-09-23T12:01:00+09:00', net_amount: 12000, approval_number: 'A1', card: { last4: '1234' } },
  );
  assert.equal(result.score, 100);
});

test('10분 이상 heartbeat가 없는 OCR 작업만 복구 대상으로 판정한다', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  assert.equal(isReceiptRunStale({ heartbeat_at: '2026-09-24T11:49:59Z' }, now), true);
  assert.equal(isReceiptRunStale({ heartbeat_at: '2026-09-24T11:55:00Z' }, now), false);
});
