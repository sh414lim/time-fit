import { financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { runCardSync } from './_card-sync-runner.js';

const authorized = req => {
  const supplied = req.headers.authorization;
  return [process.env.CARD_SYNC_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean).some(secret => supplied === `Bearer ${secret}`);
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: 'Missing server configuration' });

  try {
    const now = new Date(); const bucket = now.toISOString().slice(0, 13);
    const connections = await financeRest(`timefit_user_card_connections?status=in.(active,degraded)&next_sync_at=lte.${encodeURIComponent(now.toISOString())}&select=*&order=next_sync_at.asc&limit=10`);
    for (const connection of connections) {
      const idempotencyKey = `${connection.id}:incremental:${bucket}`;
      const existing = await financeRest(`timefit_user_card_sync_runs?organization_id=eq.${encodeURIComponent(connection.organization_id)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=id,status`);
      if (!existing.length) await financeRest('timefit_user_card_sync_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ organization_id: connection.organization_id, connection_id: connection.id, sync_type: 'approvals', idempotency_key: idempotencyKey, status: 'queued', attempt_count: 0 }]) });
    }

    const workerId = `card-worker-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const claimed = await financeRest('rpc/timefit_user_claim_card_sync_runs', {
      method: 'POST',
      body: JSON.stringify({ p_worker_id: workerId, p_limit: Math.max(1, Math.min(Number(process.env.CARD_SYNC_WORKER_BATCH_SIZE || 1), 5)), p_lease_seconds: 330 }),
    });
    const results = [];
    for (const run of claimed || []) {
      const rows = await financeRest(`timefit_user_card_connections?id=eq.${encodeURIComponent(run.connection_id)}&organization_id=eq.${encodeURIComponent(run.organization_id)}&select=*`);
      const connection = rows[0];
      if (!connection) {
        await financeRest(`timefit_user_card_sync_runs?id=eq.${encodeURIComponent(run.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', error_code: 'connection_not_found', error_category: 'invalid_request', lease_owner: null, lease_expires_at: null, finished_at: new Date().toISOString() }) });
        results.push({ connectionId: run.connection_id, runId: run.id, status: 'failed', error: 'connection_not_found' });
        continue;
      }
      try {
        const mode = String(run.idempotency_key || '').includes(':backfill:') ? 'backfill' : 'incremental';
        const result = await runCardSync({ connection, runId: run.id, mode });
        results.push({ connectionId: connection.id, runId: run.id, status: 'succeeded', ...result });
      } catch (error) { results.push({ connectionId: connection.id, runId: run.id, status: 'failed', error: String(error.message || 'sync_failed').slice(0,120) }); }
    }
    return res.status(200).json({ ok: true, processed: results.length, succeeded: results.filter(item => item.status === 'succeeded').length, failed: results.filter(item => item.status === 'failed').length, results });
  } catch (error) {
    return financeError(res, error, '예약 카드 동기화를 완료하지 못했습니다.');
  }
}
