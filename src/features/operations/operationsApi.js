import { supabase } from '../../lib/supabase';

export async function loadOperations(organizationId, scope, filters = {}, signal) {
  if (!supabase || !organizationId) throw new Error('사업장 연결을 확인해 주세요.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('다시 로그인해 주세요.');
  const query = new URLSearchParams({ organizationId, scope, ...filters });
  const response = await fetch(`/api/operations-feedback?${query}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || '운영 요약을 불러오지 못했습니다.');
  return payload.data;
}

export async function correctAttendance({ organizationId, issue, checkedIn, checkedOut, reason }) {
  const { error } = await supabase.rpc('timefit_user_correct_attendance', {
    p_organization_id: organizationId, p_staff_id: issue.employee.id, p_work_date: issue.date,
    p_checked_in_at: `${checkedIn}+09:00`, p_checked_out_at: checkedOut ? `${checkedOut}+09:00` : null,
    p_reason: reason, p_expected_updated_at: issue.record?.updated_at || null,
  });
  if (error) throw error;
}
