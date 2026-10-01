import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaverReviewAnalytics, classifyNaverReview, reviewPeriod } from '../src/features/reviews/reviewAnalytics.js';

const review = (id, content, occurredAt, rating = null, source = 'naver') => ({ id, source, kind: 'review', content, occurred_at: occurredAt, rating });

test('네이버 음식점 리뷰를 9개 테마와 긍부정 키워드로 분류한다', () => {
  const result = classifyNaverReview(review('1', '커피가 맛있고 직원이 친절해요. 좌석도 편안합니다.', '2026-09-29T03:00:00Z', 5));
  assert.equal(result.sentiment, 'positive');
  assert.deepEqual(new Set(result.mentions.map(item => item.themeId)), new Set(['food', 'menu', 'seat', 'service']));
  assert.ok(result.mentions.every(item => item.sentiment === 'positive'));
});

test('한 리뷰 안의 긍정 음식과 부정 서비스를 테마별로 따로 판정한다', () => {
  const result = classifyNaverReview(review('mixed', '커피 맛은 좋아요. 하지만 직원은 불친절했어요.', '2026-09-29T03:00:00Z'));
  assert.equal(result.mentions.find(item => item.keywordId === 'taste').sentiment, 'positive');
  assert.equal(result.mentions.find(item => item.keywordId === 'kindness').sentiment, 'negative');
});

test('주간 기간은 월요일부터 일요일이며 이전 동일 기간을 만든다', () => {
  assert.deepEqual(reviewPeriod('week', '2026-09-30'), { from: '2026-09-28', to: '2026-10-04', previousFrom: '2026-09-21', previousTo: '2026-09-27', days: 7 });
});

test('TOP3와 증감은 현재 기간과 이전 동일 기간의 언급수를 비교한다', () => {
  const result = buildNaverReviewAnalytics([
    review('old', '직원이 친절해요', '2026-09-23T03:00:00Z', 5),
    review('new-1', '직원이 친절하고 커피가 맛있어요', '2026-09-29T03:00:00Z', 5),
    review('new-2', '직원이 친절하고 매장이 깨끗해요', '2026-09-30T03:00:00Z', 5),
    review('other', '다른 채널 리뷰', '2026-09-30T03:00:00Z', 5, 'catchtable'),
  ], { period: 'week', anchor: '2026-09-30' });
  assert.equal(result.reviewCount, 2);
  assert.equal(result.totalSourceReviews, 3);
  const kindness = result.topPositive.find(item => item.keywordId === 'kindness');
  assert.equal(kindness.count, 2);
  assert.equal(kindness.previousCount, 1);
  assert.equal(kindness.changeRate, 100);
});

test('리뷰 수와 테마 언급 수를 분리하고 중립 리뷰는 분석 집계에서 제외한다', () => {
  const result = buildNaverReviewAnalytics([
    review('positive', '맛있고 친절해요', '2026-09-30T03:00:00Z', 5),
    review('neutral', '오늘 방문했습니다', '2026-09-30T04:00:00Z', null),
  ], { period: 'day', anchor: '2026-09-30' });
  assert.equal(result.reviewCount, 2);
  assert.equal(result.analyzedReviewCount, 1);
  assert.equal(result.neutralReviews, 1);
  assert.ok(result.mentionCount >= 2);
});

test('저장된 서버 AI 분석을 규칙 기반 결과보다 우선 사용한다', () => {
  const item = review('ai-1', '좋은지 나쁜지 애매한 문장', '2026-09-08T03:00:00Z');
  item.analysis = { sentiment: 'negative', urgency: 'high', summary: '좌석 간격이 좁다는 의견', model: 'test-model', mentions: [{ themeId: 'seat', keyword: '좌석 간격', sentiment: 'negative', confidence: 0.95 }] };
  const classified = classifyNaverReview(item);
  assert.equal(classified.urgency, 'high');
  assert.equal(classified.summary, '좌석 간격이 좁다는 의견');
  assert.deepEqual(classified.mentions.map(mention => [mention.themeId, mention.sentiment]), [['seat', 'negative']]);
});
