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
  const { data, error } = await supabase.functions.invoke('get-user-context');
  if (error) throw error;
  return { session, profile: data.profile, membership: data.membership, invitation: data.invitation };
}

export async function signUp({ email, password, displayName, accountType, organizationName }) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { error: signupError } = await supabase.functions.invoke('register-user', { body: { email, password, displayName, accountType, organizationName } });
  if (signupError) throw signupError;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
  if (!supabase || session.user.user_metadata?.role !== 'manager') return null;
  const name = session.user.user_metadata?.organization_name?.trim();
  if (!name) return null;
  const { data: organizationId, error } = await supabase.rpc('timefit_user_bootstrap_organization', { p_name: name });
  if (error) throw error;
  return { organization_id: organizationId, timefit_user_organizations: { id: organizationId, name } };
}

export async function inviteEmployeeByCode({ organizationId, employeeCode, department, jobTitle }) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.rpc('timefit_user_create_invitation', { p_organization_id: organizationId, p_employee_code: employeeCode, p_department: department || null, p_job_title: jobTitle || null });
  if (error) throw error;
  return data;
}

export async function acceptEmployeeInvitation(invitationId) {
  if (!supabase) throw new Error('Supabase 연결 정보가 없습니다.');
  const { data, error } = await supabase.rpc('timefit_user_accept_invitation', { p_invitation_id: invitationId });
  if (error) throw error;
  return data;
}
