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
