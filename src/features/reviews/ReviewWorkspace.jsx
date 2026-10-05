import React, { useEffect, useState } from 'react';
import {
  importFeedbackItems,
  loadFeedbackItems,
  updateFeedbackItem,
} from '../../lib/supabase';
import NaverAiReviewDashboard from './NaverAiReviewDashboard';

const parseCsv = text => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const normalizeHeader = value => String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const normalizeSource = (value, fallback) => {
  const source = String(value || '').trim().toLowerCase();
  if (source.includes('google') || source.includes('구글')) return 'google';
  if (source.includes('naver') || source.includes('네이버')) return 'naver';
  if (source.includes('kakao') || source.includes('카카오')) return 'kakao';
  if (source.includes('catch') || source.includes('캐치')) return 'catchtable';
  return fallback === 'internal' ? 'other' : fallback;
};
const csvFingerprint = value => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
  return `csv_${(hash >>> 0).toString(36)}`;
};

export default function ReviewWorkspace({ organizationId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = () => {
    setLoading(true);
    return loadFeedbackItems(organizationId)
      .then(rows => setItems(rows.filter(item => item.kind === 'review' && item.source !== 'internal')))
      .catch(error => setMessage(error.message || '리뷰를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (organizationId) refresh(); }, [organizationId]);

  const resolve = async item => {
    try {
      await updateFeedbackItem(item.id, { status: item.status === 'resolved' ? 'open' : 'resolved' });
      await refresh();
    } catch (error) { setMessage(error.message || '리뷰 상태를 변경하지 못했습니다.'); }
  };

  const importCsv = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('csvFile');
    const defaultSource = form.get('csvSource');
    if (!(file instanceof File) || !file.size) { setMessage('가져올 CSV 파일을 선택해 주세요.'); return; }
    if (file.size > 5 * 1024 * 1024) { setMessage('CSV 파일은 5MB 이하만 가져올 수 있습니다.'); return; }
    setBusy(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error('제목 행과 리뷰 데이터가 포함된 CSV를 선택해 주세요.');
      const headers = rows[0].map(normalizeHeader);
      const column = (...names) => headers.findIndex(header => names.some(name => header === normalizeHeader(name)));
      const authorIndex = column('작성자', '고객명', 'author', 'writer', 'name');
      const ratingIndex = column('평점', '별점', 'rating', 'stars', 'star');
      const contentIndex = column('리뷰', '내용', '본문', 'content', 'comment', 'review', '후기');
      const dateIndex = column('작성일', '작성날짜', '등록일', '작성시간', 'date', 'createdat', 'created');
      const sourceIndex = column('채널', 'source', 'platform', '매체');
      const idIndex = column('리뷰id', 'reviewid', 'externalid', 'id', '번호');
      if (contentIndex < 0) throw new Error('리뷰 내용 열을 찾지 못했습니다.');
      const imported = rows.slice(1).flatMap(values => {
        const content = String(values[contentIndex] || '').trim();
        if (!content) return [];
        const source = normalizeSource(sourceIndex >= 0 ? values[sourceIndex] : '', defaultSource);
        const rawDate = dateIndex >= 0 ? values[dateIndex] : '';
        const parsedDate = rawDate ? new Date(rawDate) : null;
        const rating = ratingIndex >= 0 ? Number(String(values[ratingIndex] || '').replace(',', '.')) : null;
        const author = authorIndex >= 0 ? String(values[authorIndex] || '').trim() : '';
        const externalId = idIndex >= 0 ? String(values[idIndex] || '').trim() : '';
        return [{
          organization_id: organizationId,
          source,
          kind: 'review',
          author_name: author || null,
          content,
          rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : null,
          occurred_at: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
          status: 'open',
          external_id: externalId || csvFingerprint(`${source}|${author}|${content}|${rawDate}|${rating || ''}`),
        }];
      });
      if (!imported.length) throw new Error('가져올 리뷰 내용이 없습니다.');
      const result = await importFeedbackItems(imported);
      event.currentTarget.reset();
      setMessage(`${result.count}건의 리뷰를 가져왔습니다.`);
      await refresh();
    } catch (error) { setMessage(error.message || 'CSV 리뷰를 가져오지 못했습니다.'); }
    finally { setBusy(false); }
  };

  return <>
    <div className="page-title"><div><p>외부 고객 반응 분석</p><h1>리뷰</h1><span>네이버 플레이스 리뷰를 수집하고 테마별 반응과 처리 상태를 확인합니다.</span></div></div>
    {loading ? <div className="loading-bar" role="status"><i/><span>리뷰를 불러오는 중…</span></div> : <NaverAiReviewDashboard items={items} loading={loading} onRefresh={refresh} onResolve={resolve}/>}
    <details className="card full-card review-recovery-tools"><summary>비상 복구용 리뷰 파일 가져오기</summary><div className="card-title"><div><h2>리뷰 CSV 가져오기</h2><p>자동 연동 장애 시 과거 자료를 복구하는 관리자 도구입니다.</p></div></div><form className="settings-form" onSubmit={importCsv}><div className="settings-input-grid"><label>리뷰 채널<select name="csvSource" defaultValue="naver"><option value="naver">Naver</option><option value="google">Google</option><option value="kakao">Kakao</option><option value="catchtable">Catchtable</option><option value="other">기타 채널</option></select></label><label>CSV 파일<input name="csvFile" type="file" accept=".csv,text/csv" required/></label></div><p className="settings-help">지원 열: 리뷰/내용, 작성자, 평점, 작성일, 채널, 리뷰 ID.</p><button className="submit" disabled={busy}>{busy ? '가져오는 중…' : '복구 파일 가져오기'}</button></form></details>
    {message && <p className="review-collector-message" role="status">{message}</p>}
  </>;
}
