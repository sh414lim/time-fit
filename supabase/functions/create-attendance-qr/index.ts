import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type CreateQrRequest = { organizationId: string; workplaceId: string; workDate: string; expiresAt: string };
const toHex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json() as CreateQrRequest;
  if (!body.organizationId || !body.workplaceId || !body.workDate || !body.expiresAt) return Response.json({ error: 'invalid_payload' }, { status: 400 });

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: membership } = await userClient.from('organization_members').select('role').eq('organization_id', body.organizationId).single();
  if (!membership || !['owner', 'admin', 'manager'].includes(membership.role)) return Response.json({ error: 'forbidden' }, { status: 403 });

  const rawToken = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  const tokenHash = toHex(new Uint8Array(hashBuffer));
  const { error } = await userClient.from('qr_attendance_tokens').insert({ organization_id: body.organizationId, workplace_id: body.workplaceId, work_date: body.workDate, expires_at: body.expiresAt, token_hash: tokenHash });
  if (error) return Response.json({ error: error.message }, { status: 422 });
  return Response.json({ data: { token: rawToken, expiresAt: body.expiresAt } });
});
