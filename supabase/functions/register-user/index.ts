import { createClient } from 'npm:@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers })
  try {
    const { email, password, displayName, accountType, organizationName } = await request.json()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email)) || String(password).length < 8) throw new Error('invalid_signup_input')
    if (!['manager', 'employee'].includes(accountType)) throw new Error('invalid_role')
    if (!String(displayName || '').trim()) throw new Error('display_name_required')
    if (accountType === 'manager' && !String(organizationName || '').trim()) throw new Error('organization_name_required')
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await admin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(), password: String(password), email_confirm: true,
      user_metadata: { display_name: String(displayName).trim(), role: accountType, organization_name: accountType === 'manager' ? String(organizationName).trim() : null },
    })
    if (error) throw error
    return new Response(JSON.stringify({ userId: data.user.id }), { status: 201, headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'signup_failed'
    const status = message.includes('already') ? 409 : 400
    return new Response(JSON.stringify({ error: message }), { status, headers })
  }
})
