import { supabase } from '../../lib/supabase';

const REQUEST_TIMEOUT_MS = 120000;

export async function loadGranterFinanceAnalytics({ organizationId, from, to, scope = 'all' }) {
  if (!supabase) throw new Error('로그인 연결 정보가 없습니다.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('로그인이 필요합니다.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const search = new URLSearchParams({ organizationId, from, to, scope });
    const response = await fetch(`/api/granter-finance-analytics?${search}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Granter 장부를 불러오지 못했습니다.');
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Granter 전체 장부 조회 시간이 초과됐습니다. 다시 시도해 주세요.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
