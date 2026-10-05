export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL || !process.env.SCHEDULE_PUSH_DISPATCH_SECRET) return res.status(503).json({ ok: false, error: 'Missing push dispatcher configuration' });
  const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/dispatch-schedule-push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timefit-dispatch-secret': process.env.SCHEDULE_PUSH_DISPATCH_SECRET },
    body: '{}'
  });
  const body = await response.json().catch(() => ({ error: 'Invalid dispatcher response' }));
  if (!response.ok) return res.status(502).json({ ok: false, error: 'Schedule push dispatch failed', detail: body?.error });
  return res.status(200).json({ ok: true, ...body });
}
