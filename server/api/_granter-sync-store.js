import { financeRest } from './_finance-server.js';

const encode = value => encodeURIComponent(String(value));

export function publicGranterSyncRun(run = {}) {
  const { result_payload: _payload, ...safe } = run;
  return { ...safe, hasSnapshot: Boolean(run.result_payload) };
}

export async function loadLatestGranterAnalytics({ organizationId, scope, from, to }) {
  const rangeFilter = scope === 'period'
    ? `&range_from=eq.${encode(from)}&range_to=eq.${encode(to)}`
    : `&range_to=eq.${encode(to)}`;
  const rows = await financeRest(
    `timefit_user_granter_sync_runs?organization_id=eq.${encode(organizationId)}&requested_scope=eq.${encode(scope)}${rangeFilter}&status=in.(succeeded,partial)&result_payload=not.is.null&select=id,status,finished_at,result_payload&order=finished_at.desc&limit=1`,
  );
  if (!rows[0]?.result_payload) return null;
  return {
    ...rows[0].result_payload,
    persisted: true,
    syncRun: { id: rows[0].id, status: rows[0].status, finishedAt: rows[0].finished_at },
  };
}

export async function loadActiveGranterSyncRun({ organizationId, scope, to }) {
  const rows = await financeRest(
    `timefit_user_granter_sync_runs?organization_id=eq.${encode(organizationId)}&requested_scope=eq.${encode(scope)}&range_to=eq.${encode(to)}&status=in.(queued,running)&select=*&order=created_at.desc&limit=1`,
  );
  return rows[0] ? publicGranterSyncRun(rows[0]) : null;
}

export async function persistInlineGranterAnalytics({ organizationId, userId, scope, from, to, payload }) {
  const bucket = new Date().toISOString().slice(0, 13);
  const idempotencyKey = `inline:${scope}:${from}:${to}:${bucket}`;
  const failedSources = payload.sourceStatus?.filter(item => item.status === 'failed').length || 0;
  const body = [{
    organization_id: organizationId,
    requested_by: userId || null,
    requested_scope: scope,
    range_from: payload.range?.from || from,
    range_to: payload.range?.to || to,
    idempotency_key: idempotencyKey,
    status: payload.partial ? 'partial' : 'succeeded',
    total_sources: payload.sourceStatus?.length || 0,
    completed_sources: payload.sourceStatus?.filter(item => item.status === 'loaded').length || 0,
    failed_sources: failedSources,
    source_status: payload.sourceStatus || [],
    result_payload: payload,
    started_at: payload.generatedAt || new Date().toISOString(),
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }];
  return financeRest('timefit_user_granter_sync_runs?on_conflict=organization_id,idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
}
