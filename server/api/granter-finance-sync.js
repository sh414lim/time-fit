import { start } from 'workflow/api';
import { granterConfigured } from './_granter.js';
import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { publicGranterSyncRun } from './_granter-sync-store.js';
import { GRANTER_FINANCE_TICKET_TYPES } from './granter-finance-analytics.js';
import { runGranterFinanceSync } from '../../workflows/granter-finance-sync.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const encode = value => encodeURIComponent(String(value));

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res);
  if (!financeServerConfigured() || !granterConfigured()) return res.status(503).json({ ok: false, error: 'Granter 동기화 서버 설정이 필요합니다.' });
  const input = req.method === 'GET' ? req.query : req.body;
  const organizationId = String(input?.organizationId || '');
  const auth = await authorizeFinance(req, organizationId, { permissionsAny: ['finance.view', 'expense.manage', 'expense.card.manage'] });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '재무 조회 권한이 필요합니다.' });

  try {
    if (req.method === 'GET') {
      const runId = String(input?.runId || '');
      if (!runId) return res.status(400).json({ ok: false, error: '동기화 작업 ID가 필요합니다.' });
      const rows = await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(runId)}&organization_id=eq.${encode(organizationId)}&select=*&limit=1`);
      if (!rows[0]) return res.status(404).json({ ok: false, error: '동기화 작업을 찾을 수 없습니다.' });
      return res.status(200).json({ ok: true, run: publicGranterSyncRun(rows[0]) });
    }

    const scope = input?.scope === 'all' ? 'all' : 'period';
    const from = String(input?.from || '');
    const to = String(input?.to || '');
    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) return res.status(400).json({ ok: false, error: '조회 기간을 확인해 주세요.' });
    const requestKey = String(input?.requestKey || '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 120) || crypto.randomUUID();
    const idempotencyKey = `${scope}:${from}:${to}:${requestKey}`;
    const existing = await financeRest(`timefit_user_granter_sync_runs?organization_id=eq.${encode(organizationId)}&idempotency_key=eq.${encode(idempotencyKey)}&select=*&limit=1`);
    if (existing[0]) return res.status(200).json({ ok: true, duplicateRequest: true, run: publicGranterSyncRun(existing[0]) });

    const rows = await financeRest('timefit_user_granter_sync_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        organization_id: organizationId,
        requested_by: auth.user.id,
        requested_scope: scope,
        range_from: from,
        range_to: to,
        idempotency_key: idempotencyKey,
        status: 'queued',
        total_sources: GRANTER_FINANCE_TICKET_TYPES.length,
      }]),
    });
    const run = rows[0];
    try {
      const workflowRun = await start(runGranterFinanceSync, [{ runId: run.id, organizationId, scope, from, to }]);
      await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(run.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ workflow_run_id: workflowRun.runId, updated_at: new Date().toISOString() }),
      });
      return res.status(202).json({ ok: true, run: { ...publicGranterSyncRun(run), workflow_run_id: workflowRun.runId } });
    } catch (error) {
      await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(run.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed', error_code: 'workflow_start_failed', error_message: String(error?.message || error).slice(0, 500), finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      }).catch(() => {});
      throw error;
    }
  } catch (error) {
    return financeError(res, error, 'Granter 동기화를 처리하지 못했습니다.');
  }
}
