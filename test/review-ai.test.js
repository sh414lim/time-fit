import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReviewAnalyses } from '../server/api/_review-ai.js';

test('리뷰 AI 결과는 허용된 리뷰와 9개 테마만 저장한다', () => {
  const rows = validateReviewAnalyses({ items: [
    { feedbackItemId: 'review-1', sentiment: 'negative', sentimentScore: -0.8, urgency: 'high', summary: '응대가 아쉬워요', mentions: [
      { themeId: 'service', keyword: '직원 응대', sentiment: 'negative', confidence: 0.92 },
      { themeId: 'unknown', keyword: '알 수 없음', sentiment: 'positive', confidence: 1 },
    ] },
    { feedbackItemId: 'other-review', sentiment: 'positive', sentimentScore: 1, urgency: 'reference', summary: '제외', mentions: [] },
  ] }, ['review-1']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].urgency, 'high');
  assert.deepEqual(rows[0].mentions.map(item => item.themeId), ['service']);
});

test('리뷰 AI 수치와 텍스트를 저장 범위로 제한한다', () => {
  const rows = validateReviewAnalyses({ items: [{ feedbackItemId: 'r1', sentiment: 'bad', sentimentScore: 9, urgency: 'bad', summary: 'a'.repeat(300), mentions: [{ themeId: 'food', keyword: 'b'.repeat(80), sentiment: 'bad', confidence: 4 }] }] }, ['r1']);
  assert.equal(rows[0].sentiment, 'neutral');
  assert.equal(rows[0].sentimentScore, 1);
  assert.equal(rows[0].urgency, 'normal');
  assert.equal(rows[0].summary.length, 180);
  assert.equal(rows[0].mentions[0].confidence, 1);
});
