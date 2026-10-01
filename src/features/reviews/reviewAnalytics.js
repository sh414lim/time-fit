const DAY_MS = 86_400_000;

export const NAVER_REVIEW_THEMES = [
  { id: 'food', label: '음식', keywords: [
    { id: 'taste', label: '맛', terms: ['맛', '맛있', '풍미', '간이', '달콤', '고소'] },
    { id: 'freshness', label: '신선함', terms: ['신선', '재료', '식재료'] },
    { id: 'portion', label: '양', terms: ['양이', '양도', '푸짐', '양은', '양이 적'] },
  ] },
  { id: 'menu', label: '메뉴', keywords: [
    { id: 'variety', label: '메뉴 다양성', terms: ['메뉴', '종류', '선택지'] },
    { id: 'signature', label: '대표 메뉴', terms: ['시그니처', '대표 메뉴', '인기 메뉴', '추천 메뉴'] },
    { id: 'dessert', label: '디저트·음료', terms: ['디저트', '케이크', '빵', '커피', '음료'] },
  ] },
  { id: 'price', label: '가격', keywords: [
    { id: 'value', label: '가성비', terms: ['가성비', '가격 대비', '값어치'] },
    { id: 'expensive', label: '가격', terms: ['가격', '비싸', '저렴', '금액'] },
    { id: 'discount', label: '할인·혜택', terms: ['할인', '쿠폰', '혜택', '적립'] },
  ] },
  { id: 'atmosphere', label: '분위기', keywords: [
    { id: 'mood', label: '분위기', terms: ['분위기', '감성', '무드'] },
    { id: 'music', label: '음악·소음', terms: ['음악', '노래', '소음', '시끄', '조용'] },
    { id: 'view', label: '뷰·사진', terms: ['뷰', '경치', '사진', '포토'] },
  ] },
  { id: 'store', label: '매장', keywords: [
    { id: 'cleanliness', label: '청결', terms: ['청결', '깨끗', '더럽', '위생'] },
    { id: 'size', label: '매장 크기', terms: ['매장', '공간', '넓', '좁'] },
    { id: 'access', label: '접근성', terms: ['위치', '접근', '찾기', '입구'] },
  ] },
  { id: 'facility', label: '시설', keywords: [
    { id: 'parking', label: '주차', terms: ['주차', '주차장'] },
    { id: 'restroom', label: '화장실', terms: ['화장실', '세면대'] },
    { id: 'amenity', label: '편의시설', terms: ['콘센트', '와이파이', 'wifi', '유아', '편의시설'] },
  ] },
  { id: 'seat', label: '좌석', keywords: [
    { id: 'comfort', label: '좌석 편안함', terms: ['좌석', '의자', '테이블', '자리', '편안'] },
    { id: 'group', label: '단체석', terms: ['단체', '모임', '가족', '인원'] },
    { id: 'spacing', label: '좌석 간격', terms: ['간격', '붙어', '다닥다닥'] },
  ] },
  { id: 'service', label: '서비스', keywords: [
    { id: 'kindness', label: '친절', terms: ['친절', '상냥', '응대', '불친절'] },
    { id: 'speed', label: '제공 속도', terms: ['빠르', '늦', '느리', '오래 걸', '기다'] },
    { id: 'accuracy', label: '주문 정확성', terms: ['주문', '누락', '잘못', '실수'] },
  ] },
  { id: 'operation', label: '운영', keywords: [
    { id: 'waiting', label: '대기', terms: ['대기', '웨이팅', '줄을', '줄이'] },
    { id: 'reservation', label: '예약', terms: ['예약', '예약금'] },
    { id: 'hours', label: '영업시간', terms: ['영업시간', '마감', '오픈', '휴무'] },
  ] },
];

const POSITIVE_WORDS = ['좋', '맛있', '친절', '만족', '추천', '최고', '깨끗', '편안', '훌륭', '신선', '재방문', '빠르', '예쁘', '넓', '저렴', '푸짐'];
const NEGATIVE_WORDS = ['아쉽', '별로', '불친절', '비싸', '더럽', '느리', '늦', '실망', '최악', '불편', '시끄', '좁', '누락', '잘못', '오래 걸', '적다', '짜다', '싱겁'];

const pad = value => String(value).padStart(2, '0');
const keyFromUtc = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const utcFromKey = key => new Date(`${key}T00:00:00Z`);
export const shiftDateKey = (key, days) => keyFromUtc(new Date(utcFromKey(key).getTime() + days * DAY_MS));
export const reviewDateKey = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export function reviewPeriod(period, anchor) {
  const safeAnchor = /^\d{4}-\d{2}-\d{2}$/.test(anchor || '') ? anchor : keyFromUtc(new Date());
  const date = utcFromKey(safeAnchor);
  let from = safeAnchor; let to = safeAnchor;
  if (period === 'week') {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    from = shiftDateKey(safeAnchor, -mondayOffset); to = shiftDateKey(from, 6);
  } else if (period === 'month') {
    from = `${safeAnchor.slice(0, 7)}-01`;
    const nextMonth = new Date(Date.UTC(Number(safeAnchor.slice(0, 4)), Number(safeAnchor.slice(5, 7)), 1));
    to = shiftDateKey(keyFromUtc(nextMonth), -1);
  }
  const days = Math.round((utcFromKey(to) - utcFromKey(from)) / DAY_MS) + 1;
  return { from, to, previousFrom: shiftDateKey(from, -days), previousTo: shiftDateKey(from, -1), days };
}

const includesAny = (text, words) => words.reduce((count, word) => count + (text.includes(word) ? 1 : 0), 0);
const sentimentFor = (text, rating) => {
  const negativeCount = includesAny(text, NEGATIVE_WORDS);
  const positiveContext = NEGATIVE_WORDS.reduce((value, word) => value.replaceAll(word, ' '), text);
  const score = includesAny(positiveContext, POSITIVE_WORDS) - negativeCount;
  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  if (Number(rating) >= 4) return 'positive';
  if (Number(rating) > 0 && Number(rating) <= 2) return 'negative';
  return 'neutral';
};

export function classifyNaverReview(review) {
  const text = String(review?.content || '').toLowerCase();
  const storedAnalysis = Array.isArray(review?.analysis) ? review.analysis[0] : review?.analysis;
  if (storedAnalysis && Array.isArray(storedAnalysis.mentions)) {
    const themeLabels = new Map(NAVER_REVIEW_THEMES.map(theme => [theme.id, theme.label]));
    const mentions = storedAnalysis.mentions.flatMap(mention => {
      if (!themeLabels.has(mention?.themeId) || !['positive','negative','neutral'].includes(mention?.sentiment)) return [];
      const keywordLabel = String(mention.keyword || themeLabels.get(mention.themeId)).trim().slice(0, 40);
      return [{ themeId: mention.themeId, themeLabel: themeLabels.get(mention.themeId), keywordId: `ai:${mention.themeId}:${keywordLabel.toLowerCase()}`, keywordLabel, sentiment: mention.sentiment, confidence: Number(mention.confidence) || 0 }];
    });
    return { review, date: reviewDateKey(review?.occurred_at), sentiment: storedAnalysis.sentiment || 'neutral', mentions, summary: storedAnalysis.summary || '', urgency: storedAnalysis.urgency || 'normal', analysisModel: storedAnalysis.model || null };
  }
  const sentiment = sentimentFor(text, review?.rating);
  const clauses = text.split(/[.!?\n]|(?:하지만|그런데|다만|반면|지만|인데)/).map(value => value.trim()).filter(Boolean);
  const mentions = [];
  NAVER_REVIEW_THEMES.forEach(theme => theme.keywords.forEach(keyword => {
    const terms = keyword.terms.map(term => term.toLowerCase());
    if (!terms.some(term => text.includes(term))) return;
    const context = clauses.filter(clause => terms.some(term => clause.includes(term))).join(' ');
    const localSentiment = sentimentFor(context, null);
    mentions.push({ themeId: theme.id, themeLabel: theme.label, keywordId: keyword.id, keywordLabel: keyword.label, sentiment: localSentiment === 'neutral' ? sentiment : localSentiment });
  }));
  return { review, date: reviewDateKey(review?.occurred_at), sentiment, mentions };
}

const emptyTheme = theme => ({ id: theme.id, label: theme.label, positive: 0, negative: 0, total: 0 });
const ratio = (current, previous) => previous ? Math.round(((current - previous) / previous) * 100) : current ? null : 0;
const bucketRows = (classified, from, to) => {
  const dates = [];
  for (let key = from; key <= to; key = shiftDateKey(key, 1)) dates.push(key);
  return dates.map(date => {
    const rows = classified.filter(item => item.date === date);
    return { date, positive: rows.reduce((sum, item) => sum + item.mentions.filter(mention => mention.sentiment === 'positive').length, 0), negative: rows.reduce((sum, item) => sum + item.mentions.filter(mention => mention.sentiment === 'negative').length, 0) };
  });
};

function aggregate(classified, from, to) {
  const rows = classified.filter(item => item.date >= from && item.date <= to);
  const themes = new Map(NAVER_REVIEW_THEMES.map(theme => [theme.id, emptyTheme(theme)]));
  const keywords = new Map();
  let mentionCount = 0;
  rows.forEach(item => item.mentions.forEach(mention => {
    if (!['positive', 'negative'].includes(mention.sentiment)) return;
    mentionCount += 1;
    const theme = themes.get(mention.themeId); theme[mention.sentiment] += 1; theme.total += 1;
    const id = `${mention.sentiment}:${mention.keywordId}`;
    const keyword = keywords.get(id) || { ...mention, count: 0 };
    keyword.count += 1; keywords.set(id, keyword);
  }));
  return { rows, themes: [...themes.values()], keywords: [...keywords.values()], mentionCount };
}

export function buildNaverReviewAnalytics(items, { period = 'week', anchor } = {}) {
  const naver = (Array.isArray(items) ? items : []).filter(item => item?.source === 'naver' && item?.kind === 'review' && item?.content);
  const latestDate = naver.map(item => reviewDateKey(item.occurred_at)).filter(Boolean).sort().at(-1);
  const selectedAnchor = anchor || latestDate || keyFromUtc(new Date());
  const range = reviewPeriod(period, selectedAnchor);
  const classified = naver.map(classifyNaverReview).filter(item => item.date);
  const current = aggregate(classified, range.from, range.to);
  const previous = aggregate(classified, range.previousFrom, range.previousTo);
  const previousKeywords = new Map(previous.keywords.map(item => [`${item.sentiment}:${item.keywordId}`, item.count]));
  const topKeywords = sentiment => current.keywords.filter(item => item.sentiment === sentiment).sort((a, b) => b.count - a.count || a.keywordLabel.localeCompare(b.keywordLabel, 'ko')).slice(0, 3).map(item => {
    const previousCount = previousKeywords.get(`${sentiment}:${item.keywordId}`) || 0;
    return { ...item, previousCount, changeRate: ratio(item.count, previousCount) };
  });
  const neutralReviews = current.rows.filter(item => !item.mentions.some(mention => mention.sentiment !== 'neutral')).length;
  return {
    range, anchor: selectedAnchor, latestDate, totalSourceReviews: naver.length,
    reviewCount: current.rows.length, analyzedReviewCount: current.rows.length - neutralReviews, neutralReviews,
    mentionCount: current.mentionCount,
    positiveMentions: current.themes.reduce((sum, item) => sum + item.positive, 0),
    negativeMentions: current.themes.reduce((sum, item) => sum + item.negative, 0),
    themes: current.themes.map(theme => {
      const prior = previous.themes.find(item => item.id === theme.id) || emptyTheme(theme);
      return { ...theme, previousPositive: prior.positive, previousNegative: prior.negative };
    }),
    topPositive: topKeywords('positive'), topNegative: topKeywords('negative'),
    trend: bucketRows(classified, range.from, range.to), classified: current.rows,
  };
}
