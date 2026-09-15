function serviceHeaders() { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' }; }
function isoDate(value, endOfDay = false) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return null; const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+09:00`); return Number.isNaN(date.valueOf()) ? null : date.toISOString(); }

export default async function handler(req, res) {
  // This response is user-specific, but the browser may reuse it briefly when
  // navigating back to Sales. The client also holds the same data in memory.
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=300');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ ok: false, error: 'Sales service unavailable' });
  const organizationId = req.query.organizationId;
  if (!organizationId) return res.status(401).json({ ok: false, error: 'Sign in required' });
  try {
    if (!(await authorizeFinance(req, organizationId, { permissionsAny: ['sales.view', 'sales.sync'] }))) return res.status(403).json({ ok: false, error: 'Sales permission required' });
    const dashboardResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/timefit_user_sales_dashboard`, {
      method: 'POST', headers: serviceHeaders(),
      body: JSON.stringify({ p_organization_id: organizationId, p_from: req.query.from || null, p_to: req.query.to || null }),
    });
    if (!dashboardResponse.ok) throw new Error('sales_read_failed');
    const dashboard = await dashboardResponse.json();
    return res.status(200).json({ ok: true, ...dashboard, filters: { from: req.query.from || null, to: req.query.to || null } });
  } catch (error) { console.error('Organization sales dashboard failed', { message: error.message }); return res.status(502).json({ ok: false, error: 'Sales data could not be loaded' }); }
}
import { authorizeFinance } from './_finance-server.js';
