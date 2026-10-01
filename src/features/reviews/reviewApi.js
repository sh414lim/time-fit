import { supabase } from '../../lib/supabase';

async function authorizedFetch(path, options = {}) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('로그인이 필요합니다.');
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '리뷰 분석 요청에 실패했습니다.');
  return body;
}

export const loadNaverReviewAnalyses = organizationId => authorizedFetch(`/api/review-analysis?organizationId=${encodeURIComponent(organizationId)}`);
export const analyzeNaverReviews = (organizationId, feedbackItemIds = []) => authorizedFetch('/api/review-analysis', { method: 'POST', body: JSON.stringify({ organizationId, feedbackItemIds }) });
