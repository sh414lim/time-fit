import { supabase } from '../../lib/supabase';

const REQUEST_TIMEOUT_MS = 120000;

async function accessToken() {
  if (!supabase) throw new Error('로그인 연결 정보가 없습니다.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('로그인이 필요합니다.');
  return session.access_token;
}

export async function loadGranterFinanceAnalytics({ organizationId, from, to, scope = 'all', refresh = false }) {
  const token = await accessToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const search = new URLSearchParams({ organizationId, from, to, scope, ...(refresh ? { refresh: '1' } : {}) });
    const response = await fetch(`/api/granter-finance-analytics?${search}`, {
      headers: { Authorization: `Bearer ${token}` },
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

export async function startGranterFinanceSync({ organizationId, from, to, scope }) {
  const token = await accessToken();
  const response = await fetch('/api/granter-finance-sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId, from, to, scope, requestKey: crypto.randomUUID() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Granter 동기화를 시작하지 못했습니다.');
  return payload.run;
}

export async function loadGranterFinanceSyncRun({ organizationId, runId }) {
  const token = await accessToken();
  const search = new URLSearchParams({ organizationId, runId });
  const response = await fetch(`/api/granter-finance-sync?${search}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Granter 동기화 상태를 확인하지 못했습니다.');
  return payload.run;
}
