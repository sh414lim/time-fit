import { start } from 'workflow/api';
import { granterConfigured } from './_granter.js';
import { financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { GRANTER_FINANCE_TICKET_TYPES } from './granter-finance-analytics.js';
import { runGranterFinanceSync } from '../../workflows/granter-finance-sync.js';

const encode = value => encodeURIComponent(String(value));
const koreaDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
const currentMonth = (now = new Date()) => {
  const to = koreaDate(now);
  return { from: `${to.slice(0, 7)}-01`, to };
};

function authorized(req) {
  return Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res);
  if (!authorized(req)) return res.status(401).json({ ok: false, error: '예약 작업 인증이 필요합니다.' });
  if (!financeServerConfigured() || !granterConfigured()) return res.status(503).json({ ok: false, error: 'Granter 동기화 서버 설정이 필요합니다.' });
  try {
    const history = await financeRest('timefit_user_granter_sync_runs?status=in.(succeeded,partial)&select=organization_id,requested_by&order=created_at.desc&limit=1000');
    const organizations = [...new Map(history.map(row => [row.organization_id, row])).values()].slice(0, 10);
    const range = currentMonth();
    const bucket = new Date().toISOString().slice(0, 13);
    const results = [];
    for (const item of organizations) {
      const idempotencyKey = `scheduled:${range.from}:${range.to}:${bucket}`;
      const existing = await financeRest(`timefit_user_granter_sync_runs?organization_id=eq.${encode(item.organization_id)}&idempotency_key=eq.${encode(idempotencyKey)}&select=id,status&limit=1`);
      if (existing[0]) { results.push({ organizationId: item.organization_id, runId: existing[0].id, status: existing[0].status, duplicate: true }); continue; }
      const rows = await financeRest('timefit_user_granter_sync_runs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{
          organization_id: item.organization_id,
          requested_by: item.requested_by,
          requested_scope: 'period',
          range_from: range.from,
          range_to: range.to,
          idempotency_key: idempotencyKey,
          status: 'queued',
          total_sources: GRANTER_FINANCE_TICKET_TYPES.length,
        }]),
      });
      const run = rows[0];
      const workflowRun = await start(runGranterFinanceSync, [{ runId: run.id, organizationId: item.organization_id, scope: 'period', from: range.from, to: range.to }]);
      await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(run.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ workflow_run_id: workflowRun.runId, updated_at: new Date().toISOString() }),
      });
      results.push({ organizationId: item.organization_id, runId: run.id, status: 'queued' });
    }
    return res.status(202).json({ ok: true, range, count: results.length, results });
  } catch (error) {
    return financeError(res, error, 'Granter 예약 동기화를 시작하지 못했습니다.');
  }
}
