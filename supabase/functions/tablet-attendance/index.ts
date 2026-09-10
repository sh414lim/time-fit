import { createClient } from 'npm:@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  try {
    const { deviceToken, phoneLast4, action, staffId, phoneLast8 } = await request.json()
    if (!deviceToken || !/^\d{4}$/.test(String(phoneLast4))) throw new Error('invalid_payload')
    if (phoneLast8 != null && !/^\d{8}$/.test(String(phoneLast8))) throw new Error('invalid_phone_last8')
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await client.rpc('timefit_user_tablet_attendance_v3', {
      p_device_token: String(deviceToken),
      p_phone_last4: String(phoneLast4),
      p_action: action,
      p_staff_id: staffId ? String(staffId) : null,
      p_phone_last8: phoneLast8 == null ? null : String(phoneLast8),
    })
    if (error) throw new Error(error.message)
    return new Response(JSON.stringify(data), { headers })
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'attendance_failed' }), { status: 400, headers }) }
})
