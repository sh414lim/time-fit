import React, { useEffect, useMemo, useState } from 'react';
import { buildNaverReviewAnalytics, reviewDateKey } from './reviewAnalytics';

const PERIODS = [{ id: 'day', label: '일간' }, { id: 'week', label: '주간' }, { id: 'month', label: '월간' }];
const shortDate = value => value ? value.slice(5).replace('-', '.') : '-';
const rangeLabel = range => range.from === range.to ? range.from : `${range.from} ~ ${range.to}`;
const changeLabel = item => item.changeRate === null ? '신규' : `${item.changeRate > 0 ? '+' : ''}${item.changeRate}%`;

function KeywordList({ title, tone, rows, onSelect }) {
  return <article className={`review-keyword-panel ${tone}`}><div><h3>{title}</h3><span>이전 동일 기간 비교</span></div>{rows.length ? rows.map((item, index) => <button key={`${item.sentiment}-${item.keywordId}`} onClick={() => onSelect({ type: 'keyword', id: item.keywordId, label: item.keywordLabel, sentiment: item.sentiment })}><b>{index + 1}</b><span><strong>#{item.keywordLabel}</strong><small>{item.themeLabel}</small></span><em>{item.count}회</em><i className={item.changeRate !== null && item.changeRate < 0 ? 'down' : ''}>{changeLabel(item)}</i></button>) : <p>분석할 {tone === 'positive' ? '긍정' : '부정'} 언급이 없습니다.</p>}</article>;
}

function ReviewMatches({ analytics, selection, onClear }) {
  if (!selection) return null;
  const matches = analytics.classified.filter(item => item.mentions.some(mention => (selection.type === 'theme' ? mention.themeId === selection.id : mention.keywordId === selection.id) && (!selection.sentiment || mention.sentiment === selection.sentiment)));
  return <section className="card full-card review-match-card"><div className="card-title"><div><h2>{selection.label} 관련 리뷰</h2><p>선택한 테마·키워드가 감지된 실제 네이버 리뷰입니다.</p></div><button onClick={onClear}>닫기</button></div>{matches.length ? matches.slice(0, 50).map(item => <article key={item.review.id || `${item.date}-${item.review.content}`}><div><b>{item.review.author_name || '익명'}</b><span>{item.date}{item.review.rating ? ` · ${item.review.rating}점` : ''}{item.urgency === 'urgent' ? ' · 긴급 확인' : item.urgency === 'high' ? ' · 우선 확인' : ''}</span></div>{item.summary && <strong className="review-ai-summary">AI 요약 · {item.summary}</strong>}<p>{item.review.content}</p><div>{item.mentions.filter(mention => (selection.type === 'theme' ? mention.themeId === selection.id : mention.keywordId === selection.id)).map(mention => <span className={`review-sentiment-chip ${mention.sentiment}`} key={`${mention.themeId}-${mention.keywordId}`}>{mention.keywordLabel} · {mention.sentiment === 'positive' ? '좋아요' : mention.sentiment === 'negative' ? '아쉬워요' : '중립'}</span>)}</div></article>) : <div className="empty-schedule"><b>조건에 맞는 리뷰가 없어요.</b></div>}</section>;
}

export default function NaverAiReviewDashboard({ items = [] }) {
  const latestNaverDate = useMemo(() => items.filter(item => item.source === 'naver' && item.kind === 'review').map(item => reviewDateKey(item.occurred_at)).filter(Boolean).sort().at(-1) || '', [items]);
  const [period, setPeriod] = useState('week');
  const [anchor, setAnchor] = useState('');
  const [selection, setSelection] = useState(null);
  useEffect(() => { if (!anchor && latestNaverDate) setAnchor(latestNaverDate); }, [anchor, latestNaverDate]);
  useEffect(() => setSelection(null), [period, anchor]);
  const analytics = useMemo(() => buildNaverReviewAnalytics(items, { period, anchor: anchor || latestNaverDate }), [items, period, anchor, latestNaverDate]);
  const maxTheme = Math.max(1, ...analytics.themes.map(item => item.total));
  const maxTrend = Math.max(1, ...analytics.trend.map(item => item.positive + item.negative));
  const selectedDate = anchor || analytics.anchor;
  const serverAnalyzed = items.filter(item => item.source === 'naver' && item.analysis).length;
  return <div className="naver-review-dashboard">
    <section className="card full-card review-overview-card"><div className="review-dashboard-head"><div><p className="review-eyebrow">NAVER REVIEW INSIGHTS · BETA</p><h2>AI 리뷰 통계</h2><span>음식점 리뷰를 9개 테마의 좋아요·아쉬워요 언급으로 자동 분석합니다.</span></div><div className="review-period-controls"><div>{PERIODS.map(item => <button className={period === item.id ? 'selected' : ''} key={item.id} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div><label>기준일<input type="date" value={selectedDate} onChange={event => setAnchor(event.target.value)}/></label></div></div>
      <div className="review-analysis-note"><b>{rangeLabel(analytics.range)}</b><span>TimeFit의 1차 자동분석 결과이며 네이버가 제공하는 공식 통계 수치와는 다를 수 있습니다. 한 리뷰에서 여러 테마가 집계될 수 있습니다.</span></div>
      <div className="review-ai-status" role="status"><i/>{serverAnalyzed ? `서버 AI 분석 ${serverAnalyzed}건 · 변경된 리뷰만 자동 재분석` : '새 리뷰는 서버 AI 분석을 자동 시도하며 준비 전에는 브라우저 1차 분석을 표시합니다.'}</div>
      <div className="review-kpi-grid"><article><span>기간 내 네이버 리뷰</span><strong>{analytics.reviewCount}<small>건</small></strong><p>저장된 전체 {analytics.totalSourceReviews}건</p></article><article><span>분석된 리뷰</span><strong>{analytics.analyzedReviewCount}<small>건</small></strong><p>중립·테마 미감지 {analytics.neutralReviews}건 제외</p></article><article className="positive"><span>좋아요 언급</span><strong>{analytics.positiveMentions}<small>회</small></strong><p>리뷰 수가 아닌 테마 언급 수</p></article><article className="negative"><span>아쉬워요 언급</span><strong>{analytics.negativeMentions}<small>회</small></strong><p>우선 확인할 운영 신호</p></article></div>
      {!analytics.totalSourceReviews && <div className="review-source-empty"><b>분석할 네이버 리뷰가 아직 없습니다.</b><span>공식 수집 연동이 준비되면 새 리뷰를 자동으로 분석합니다. 수동 입력을 정상 운영 경로로 요구하지 않습니다.</span></div>}
    </section>

    <section className="review-keyword-grid"><KeywordList title="긍정 키워드 TOP 3" tone="positive" rows={analytics.topPositive} onSelect={setSelection}/><KeywordList title="부정 키워드 TOP 3" tone="negative" rows={analytics.topNegative} onSelect={setSelection}/></section>

    <section className="card full-card review-trend-card"><div className="card-title"><div><h2>리뷰 반응 추이</h2><p>선택 기간의 날짜별 긍정·부정 테마 언급량입니다.</p></div><div className="review-legend"><span className="positive">좋아요</span><span className="negative">아쉬워요</span></div></div><div className="review-trend-chart">{analytics.trend.map(point => <div key={point.date} title={`${point.date} · 좋아요 ${point.positive} · 아쉬워요 ${point.negative}`}><span className="review-trend-bars"><i className="positive" style={{ height: `${Math.max(point.positive ? 8 : 0, point.positive / maxTrend * 100)}%` }}/><i className="negative" style={{ height: `${Math.max(point.negative ? 8 : 0, point.negative / maxTrend * 100)}%` }}/></span><small>{shortDate(point.date)}</small></div>)}</div>{analytics.trend.length > 14 && <p className="review-scroll-hint">가로로 밀어 날짜별 수치를 확인할 수 있습니다.</p>}</section>

    <section className="card full-card review-theme-card"><div className="card-title"><div><h2>9개 테마별 분석</h2><p>막대 또는 테마를 누르면 해당 실제 리뷰를 확인할 수 있습니다.</p></div><strong>{analytics.mentionCount}회 언급</strong></div><div className="review-theme-list">{analytics.themes.map(theme => <button key={theme.id} onClick={() => setSelection({ type: 'theme', id: theme.id, label: theme.label })}><b>{theme.label}</b><span className="review-theme-bar"><i className="positive" style={{ width: `${theme.positive / maxTheme * 100}%` }}/><i className="negative" style={{ width: `${theme.negative / maxTheme * 100}%` }}/></span><span className="review-theme-values"><em>좋아요 {theme.positive}</em><em>아쉬워요 {theme.negative}</em></span><i aria-hidden="true">›</i></button>)}</div></section>
    <ReviewMatches analytics={analytics} selection={selection} onClear={() => setSelection(null)}/>
  </div>;
}
