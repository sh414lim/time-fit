import React, { useEffect, useMemo, useState } from 'react';
import { collectedReviewSummary, filterCollectedReviews, REVIEW_SOURCE_LABELS, reviewKeywords, reviewRating } from './reviewFeedModel';
import { getAuthContext, loadFeedbackItems, loadNaverReviewCollectionJob, searchNaverReviewPlaces, startNaverReviewCollection } from '../../lib/supabase';

const PAGE_SIZE = 20;
const dateLabel = value => {
  if (!value) return '날짜 정보 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 정보 없음' : date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
};
const collectedLabel = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
};

export default function ReviewFeed({ items, loading = false, onRefresh, onResolve, onItemsLoaded }) {
  const [displayItems, setDisplayItems] = useState(items || []);
  const [organizationId, setOrganizationId] = useState(null);
  const [canManageSources, setCanManageSources] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState([]);
  const [searching, setSearching] = useState(false);
  const [job, setJob] = useState(null);
  const [collectorMessage, setCollectorMessage] = useState('');
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [rating, setRating] = useState('all');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const summary = useMemo(() => collectedReviewSummary(displayItems), [displayItems]);
  const reviews = useMemo(() => filterCollectedReviews(displayItems, { source, status, rating, query }), [displayItems, source, status, rating, query]);
  useEffect(() => setDisplayItems(items || []), [items]);
  useEffect(() => {
    let active = true;
    getAuthContext().then(context => {
      if (!active) return;
      setOrganizationId(context.membership?.organization_id || null);
      setCanManageSources(Boolean(context.isOrganizationOwner));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => setVisibleCount(PAGE_SIZE), [source, status, rating, query]);

  useEffect(() => {
    if (!job?.id || !organizationId || ['succeeded', 'failed'].includes(job.status)) return undefined;
    let active = true; let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await loadNaverReviewCollectionJob({ organizationId, jobId: job.id });
        if (!active) return;
        if (next.status === 'succeeded') {
          const refreshed = await loadFeedbackItems(organizationId);
          if (!active) return;
          setDisplayItems(refreshed);
          onItemsLoaded?.(refreshed);
          setCollectorMessage(`${next.place?.name || '선택한 플레이스'} 리뷰 ${next.upsertedCount || 0}건을 불러왔습니다.`);
        } else if (next.status === 'failed') setCollectorMessage(next.error || '리뷰 수집에 실패했습니다.');
        setJob(next);
      } catch (error) {
        if (active) setCollectorMessage(error.message || '수집 상태를 확인하지 못했습니다.');
      } finally { polling = false; }
    };
    poll();
    const timer = window.setInterval(poll, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [job?.id, job?.status, organizationId, onItemsLoaded]);

  const searchPlaces = async event => {
    event.preventDefault();
    const value = placeQuery.trim();
    if (!organizationId || value.length < 2) { setCollectorMessage('플레이스 검색어를 2자 이상 입력해 주세요.'); return; }
    setSearching(true); setCollectorMessage(''); setPlaces([]);
    try {
      const results = await searchNaverReviewPlaces({ organizationId, query: value });
      setPlaces(results);
      if (!results.length) setCollectorMessage('검색된 플레이스가 없습니다. 상호명과 지역을 함께 입력해 주세요.');
    } catch (error) { setCollectorMessage(error.message || '플레이스를 검색하지 못했습니다.'); }
    finally { setSearching(false); }
  };
  const collectPlace = async place => {
    setCollectorMessage(''); setJob({ status: 'starting', place });
    try {
      const next = await startNaverReviewCollection({ organizationId, place, searchQuery: placeQuery.trim(), limit: 5000 });
      setJob(next); setCollectorMessage('백그라운드에서 리뷰를 수집하고 있습니다. 이 화면을 벗어나도 작업은 계속됩니다.');
    } catch (error) { setJob(null); setCollectorMessage(error.message || '리뷰 수집을 시작하지 못했습니다.'); }
  };

  return <section className="card full-card collected-review-card">
    <div className="card-title collected-review-head"><div><h2>수집 리뷰</h2><p>리뷰 수집 워커가 저장한 실제 후기를 최신 방문일 순서로 보여줍니다.</p></div>{onRefresh && <button type="button" className="outline" disabled={loading} onClick={onRefresh}>{loading ? '불러오는 중…' : '새로고침'}</button>}</div>
    {canManageSources && <div className="review-place-connect"><div><b>네이버 플레이스 연결</b><span>회사에 연결할 매장을 직접 검색한 뒤 더 이상 불러올 리뷰가 없을 때까지 백그라운드로 가져옵니다.</span></div><form onSubmit={searchPlaces}><input value={placeQuery} onChange={event => setPlaceQuery(event.target.value)} placeholder="상호명 또는 상호명 + 지역"/><button className="submit" disabled={searching || job && !['succeeded', 'failed'].includes(job.status)}>{searching ? '검색 중…' : '플레이스 검색'}</button></form>{places.length > 0 && <div className="review-place-results">{places.map(place => <article key={place.placeId}><span><b>{place.name || '이름 없음'}</b><small>{place.address || '주소 정보 없음'} · ID {place.placeId}</small></span><button type="button" className="outline" disabled={job && !['succeeded', 'failed'].includes(job.status)} onClick={() => collectPlace(place)}>전체 리뷰 가져오기</button></article>)}</div>}{job && <div className={`review-collection-status ${job.status}`}><i/><span><b>{job.place?.name || '선택한 플레이스'}</b> · {job.status === 'succeeded' ? '수집 완료' : job.status === 'failed' ? '수집 실패' : '백그라운드 수집 중'}{job.status === 'succeeded' ? ` · ${job.upsertedCount || 0}건 반영` : ''}</span></div>}{collectorMessage && <p className="review-collector-message">{collectorMessage}</p>}</div>}
    <div className="collected-review-summary"><span><b>{summary.total}</b>전체 리뷰</span><span><b>{summary.open}</b>확인 필요</span><span className={summary.lowRating ? 'warning' : ''}><b>{summary.lowRating}</b>2점 이하</span><span><b>{summary.sources.length}</b>연결 채널</span></div>
    <div className="collected-review-filters">
      <label>채널<select value={source} onChange={event => setSource(event.target.value)}><option value="all">전체 채널</option>{summary.sources.map(value => <option value={value} key={value}>{REVIEW_SOURCE_LABELS[value] || value}</option>)}</select></label>
      <label>처리 상태<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">전체 상태</option><option value="open">확인 필요</option><option value="resolved">처리 완료</option></select></label>
      <label>평점<select value={rating} onChange={event => setRating(event.target.value)}><option value="all">전체 평점</option><option value="low">2점 이하</option><option value="middle">2.5~3.5점</option><option value="high">4점 이상</option></select></label>
      <label className="collected-review-search">리뷰 검색<input value={query} onChange={event => setQuery(event.target.value)} placeholder="본문·키워드 검색"/></label>
    </div>
    {reviews.length ? <><div className="collected-review-list">{reviews.slice(0, visibleCount).map(item => {
      const keywords = reviewKeywords(item);
      const score = reviewRating(item);
      const collectedAt = collectedLabel(item.collected_at);
      const visitContext = Array.isArray(item.source_metadata?.visitContext) ? item.source_metadata.visitContext : [];
      return <article className={`collected-review-item${score !== null && score <= 2 ? ' low-rating' : ''}`} key={item.id || item.external_id}>
        <div className="collected-review-meta"><span className={`review-source-badge ${item.source}`}>{REVIEW_SOURCE_LABELS[item.source] || item.source}</span>{score !== null && <strong>★ {score.toFixed(score % 1 ? 1 : 0)}</strong>}<span>{dateLabel(item.occurred_at)}</span>{item.verification_method && <span>{item.verification_method} 인증</span>}<i className={item.status === 'resolved' ? 'resolved' : ''}>{item.status === 'resolved' ? '처리 완료' : '확인 필요'}</i></div>
        <p>{item.content}</p>
        {(keywords.length > 0 || visitContext.length > 0) && <div className="collected-review-keywords">{keywords.slice(0, 6).map(keyword => <span key={keyword}>#{keyword}</span>)}{visitContext.slice(0, 3).map(context => <span className="context" key={context}>{context}</span>)}</div>}
        <div className="collected-review-footer"><span>{item.author_name || '익명 리뷰어'}{collectedAt ? ` · ${collectedAt} 수집` : ''}</span><div>{item.source_url && <a className="outline" href={item.source_url} target="_blank" rel="noreferrer">원문 보기</a>}{onResolve && <button type="button" className="outline" onClick={() => onResolve(item)}>{item.status === 'resolved' ? '다시 열기' : '처리 완료'}</button>}</div></div>
      </article>;
    })}</div>{visibleCount < reviews.length && <button type="button" className="outline collected-review-more" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>리뷰 더 보기 · {reviews.length - visibleCount}건 남음</button>}</> : <div className="review-source-empty"><b>{summary.total ? '조건에 맞는 리뷰가 없습니다.' : '수집된 외부 리뷰가 아직 없습니다.'}</b><span>{summary.total ? '필터나 검색어를 변경해 주세요.' : '수집 워커가 저장한 리뷰는 이곳에 자동으로 표시됩니다.'}</span></div>}
  </section>;
}
