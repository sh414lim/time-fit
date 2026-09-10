import { createClient } from 'npm:@supabase/supabase-js@2'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
Deno.serve(async (request) => { if (request.method === 'OPTIONS') return new Response('ok',{headers}); try {
  const { deviceToken, phoneLast8, startsOn, endsOn, leaveType } = await request.json()
  if (!deviceToken || !/^\d{8}$/.test(String(phoneLast8)) || !startsOn || !endsOn || !['연차','오전 반차','오후 반차'].includes(leaveType)) throw new Error('invalid_payload')
  if (startsOn < new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}) || endsOn < startsOn) throw new Error('invalid_date')
  const client=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_ANON_KEY')??'',{auth:{autoRefreshToken:false,persistSession:false}})
  const {data,error}=await client.rpc('timefit_user_tablet_leave_request_v2',{p_device_token:String(deviceToken),p_phone_last8:String(phoneLast8),p_starts_on:startsOn,p_ends_on:endsOn,p_leave_type:leaveType})
  if(error) throw new Error(error.message)
  return new Response(JSON.stringify(data),{headers})
} catch(error){return new Response(JSON.stringify({error:error instanceof Error?error.message:'leave_request_failed'}),{status:400,headers})} })
