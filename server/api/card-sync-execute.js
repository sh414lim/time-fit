import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { runCardSync } from './_card-sync-runner.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 연결 서버 설정이 필요합니다.' });
  const { organizationId, runId } = req.body || {};
  const auth = await authorizeFinance(req, organizationId, { permissionsAny: ['expense.manage'] });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '관리자 인증이 필요합니다.' });
  if (!runId) return res.status(400).json({ ok: false, error: '실행할 동기화 작업 ID가 필요합니다.' });

  try {
    const workerId = `manual-${auth.user.id}-${Date.now()}`;
    const claimed = await financeRest(`timefit_user_card_sync_runs?id=eq.${encodeURIComponent(runId)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.queued`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'running', attempt_count: 1, lease_owner: workerId, lease_expires_at: new Date(Date.now() + 330000).toISOString(), heartbeat_at: new Date().toISOString() }),
    });
    if (!claimed.length) {
      const existing = await financeRest(`timefit_user_card_sync_runs?id=eq.${encodeURIComponent(runId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id,status,inserted_count,duplicate_count,finished_at,error_category`);
      if (!existing.length) return res.status(404).json({ ok: false, error: '동기화 작업을 찾을 수 없습니다.' });
      return res.status(existing[0].status === 'succeeded' ? 200 : 202).json({ ok: true, alreadyStarted: true, run: existing[0] });
    }
    const run = claimed[0];
    const connections = await financeRest(`timefit_user_card_connections?id=eq.${encodeURIComponent(run.connection_id)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=*`);
    const connection = connections[0];
    if (!connection || connection.status === 'disconnected') return res.status(404).json({ ok: false, error: '실행할 카드 연결을 찾을 수 없습니다.' });
    const mode = String(run.idempotency_key || '').includes(':backfill:') ? 'backfill' : 'incremental';
    const result = await runCardSync({ connection, runId: run.id, mode });
    return res.status(200).json({ ok: true, runId: run.id, result });
  } catch (error) {
    return financeError(res, error, '카드 내역 즉시 동기화를 완료하지 못했습니다. 예약 작업으로 다시 시도합니다.');
  }
}
