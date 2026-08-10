import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export async function recordQrAttendance(payload) {
  if (!supabase) throw new Error('Supabase 환경 변수가 설정되지 않았습니다.');
  const { data, error } = await supabase.functions.invoke('qr-attendance', { body: payload });
  if (error) throw error;
  return data;
}

export async function getAuthContext() {
  if (!supabase) return { session: null, profile: null, membership: null, invitation: null };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { session: null, profile: null, membership: null, invitation: null };
  const [profileResult, memberResult, inviteResult] = await Promise.all([
    supabase.from('profiles').select('id, display_name, employee_code').eq('id', session.user.id).maybeSingle(),
    supabase.from('organization_members').select('organization_id, workplace_id, role, organizations(id, name)').eq('user_id', session.user.id).limit(1).maybeSingle(),
    supabase.from('employee_invitations').select('id, organization_id, status, organizations(name)').eq('target_user_id', session.user.id).eq('status', 'pending').limit(1).maybeSingle(),
  ]);
  return { session, profile: profileResult.data, membership: memberResult.data, invitation: inviteResult.data };
}

export async function signUp({ email, password, displayName, accountType, organizationName }) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, account_type: accountType, organization_name: organizationName || null } } });
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function ensureManagerOrganization(session) {
  if (!supabase || session.user.user_metadata?.account_type !== 'manager') return null;
  const { data: current } = await supabase.from('organization_members').select('organization_id, organizations(id, name)').eq('user_id', session.user.id).limit(1).maybeSingle();
  if (current) return current;
  const name = session.user.user_metadata?.organization_name?.trim();
  if (!name) return null;
  const { data: organizationId, error } = await supabase.rpc('bootstrap_organization', { p_name: name });
  if (error) throw error;
  const { error: workplaceError } = await supabase.from('workplaces').insert({ organization_id: organizationId, name: '기본 사업장' });
  if (workplaceError) throw workplaceError;
  return { organization_id: organizationId, organizations: { id: organizationId, name } };
}

export async function inviteEmployeeByCode({ organizationId, employeeCode, department, jobTitle }) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.rpc('create_employee_invitation', { p_organization_id: organizationId, p_employee_code: employeeCode, p_department: department || null, p_job_title: jobTitle || null });
  if (error) throw error;
  return data;
}

export async function acceptEmployeeInvitation(invitationId) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.rpc('accept_employee_invitation', { p_invitation_id: invitationId });
  if (error) throw error;
  return data;
}
