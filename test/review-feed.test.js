import test from 'node:test';
import assert from 'node:assert/strict';
import { collectedReviewSummary, filterCollectedReviews, reviewKeywords } from '../src/features/reviews/reviewFeedModel.js';

const rows = [
  { id: 'n1', kind: 'review', source: 'naver', status: 'open', rating: 1, content: '직원이 불친절해요', keywords: ['서비스'], occurred_at: '2026-10-01T12:00:00+09:00' },
  { id: 'n2', kind: 'review', source: 'naver', status: 'resolved', rating: 5, content: '피자가 맛있어요', keywords: '["피자","맛"]', occurred_at: '2026-09-30T12:00:00+09:00' },
  { id: 'g1', kind: 'review', source: 'google', status: 'open', rating: 3, content: '분위기가 좋아요', keywords: [], occurred_at: '2026-09-29T12:00:00+09:00' },
  { id: 'n3', kind: 'review', source: 'naver', status: 'open', rating: null, content: '별점 없는 리뷰', keywords: [], occurred_at: '2026-09-28T12:00:00+09:00' },
  { id: 'i1', kind: 'complaint', source: 'internal', status: 'open', content: '내부 이슈', occurred_at: '2026-10-02T12:00:00+09:00' },
];

test('수집 리뷰 목록에서 내부 이슈를 제외하고 최신 방문일 순으로 정렬한다', () => {
  assert.deepEqual(filterCollectedReviews(rows).map(item => item.id), ['n1', 'n2', 'g1', 'n3']);
});

test('채널·상태·평점·본문 및 키워드 필터를 조합한다', () => {
  assert.deepEqual(filterCollectedReviews(rows, { source: 'naver', status: 'open', rating: 'low' }).map(item => item.id), ['n1']);
  assert.deepEqual(filterCollectedReviews(rows, { query: '피자' }).map(item => item.id), ['n2']);
  assert.deepEqual(reviewKeywords(rows[1]), ['피자', '맛']);
});

test('수집 리뷰 요약은 전체·미처리·저평점·채널 수를 분리한다', () => {
  assert.deepEqual(collectedReviewSummary(rows), { total: 4, open: 3, lowRating: 1, sources: ['naver', 'google'] });
});
