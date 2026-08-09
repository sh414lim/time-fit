import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type QrAttendanceRequest = { token: string; action: 'check_in' | 'check_out'; latitude?: number; longitude?: number };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json() as QrAttendanceRequest;
  if (!body.token || !['check_in', 'check_out'].includes(body.action)) return Response.json({ error: 'invalid_payload' }, { status: 400 });

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await client.rpc('record_qr_attendance', { p_token: body.token, p_action: body.action, p_latitude: body.latitude ?? null, p_longitude: body.longitude ?? null });
  if (error) return Response.json({ error: error.message }, { status: 422 });
  return Response.json({ data });
});
