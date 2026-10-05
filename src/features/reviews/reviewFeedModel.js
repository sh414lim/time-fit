export const REVIEW_SOURCE_LABELS = Object.freeze({
  naver: '네이버',
  catchtable: '캐치테이블',
  google: '구글',
  kakao: '카카오',
  other: '기타',
});

export function reviewKeywords(item) {
  if (Array.isArray(item?.keywords)) return item.keywords.map(value => String(value || '').trim()).filter(Boolean);
  if (typeof item?.keywords === 'string') {
    try {
      const parsed = JSON.parse(item.keywords);
      return Array.isArray(parsed) ? parsed.map(value => String(value || '').trim()).filter(Boolean) : [];
    } catch { return []; }
  }
  return [];
}

export function reviewRating(item) {
  if (item?.rating === null || item?.rating === undefined || item?.rating === '') return null;
  const value = Number(item.rating);
  return Number.isFinite(value) ? value : null;
}

export function filterCollectedReviews(items, filters = {}) {
  const source = filters.source || 'all';
  const status = filters.status || 'all';
  const rating = filters.rating || 'all';
  const query = String(filters.query || '').trim().toLocaleLowerCase('ko-KR');
  return (items || []).filter(item => {
    if (item.kind !== 'review' || item.source === 'internal') return false;
    if (source !== 'all' && item.source !== source) return false;
    if (status === 'open' && item.status === 'resolved') return false;
    if (status === 'resolved' && item.status !== 'resolved') return false;
    const score = reviewRating(item);
    if (rating === 'low' && (score === null || score > 2)) return false;
    if (rating === 'middle' && (score === null || score < 2.5 || score > 3.5)) return false;
    if (rating === 'high' && (score === null || score < 4)) return false;
    if (query) {
      const searchable = [item.content, item.author_name, REVIEW_SOURCE_LABELS[item.source], ...reviewKeywords(item)].filter(Boolean).join(' ').toLocaleLowerCase('ko-KR');
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).sort((left, right) => String(right.occurred_at || right.created_at || '').localeCompare(String(left.occurred_at || left.created_at || '')));
}

export function collectedReviewSummary(items) {
  const reviews = filterCollectedReviews(items);
  return {
    total: reviews.length,
    open: reviews.filter(item => item.status !== 'resolved').length,
    lowRating: reviews.filter(item => reviewRating(item) !== null && reviewRating(item) <= 2).length,
    sources: [...new Set(reviews.map(item => item.source).filter(Boolean))],
  };
}
