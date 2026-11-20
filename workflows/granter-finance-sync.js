import { buildAnalytics, GRANTER_FINANCE_TICKET_TYPES } from '../server/api/granter-finance-analytics.js';
import { financeRest } from '../server/api/_finance-server.js';
import { persistGranterFinanceFacts } from '../server/api/_profit-store.js';
import { rebuildProfitSnapshot } from '../server/api/_profit-overview.js';
import { sleep } from 'workflow';

const encode = value => encodeURIComponent(String(value));
const SNAPSHOT_ROW_LIMIT = 4000;

async function executeGranterFinanceSync(input) {
  'use step';
  console.info('Granter sync step started', { runId: input.runId, scope: input.scope });
  const statuses = [];
  const startedAt = new Date().toISOString();
  await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(input.runId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'running', started_at: startedAt, updated_at: startedAt, error_code: null, error_message: null }),
  });

  try {
    const payload = await buildAnalytics({
      from: input.from,
      to: input.to,
      scope: input.scope,
      onSourceSettled: async source => {
        const failed = source.status === 'failed';
        statuses.push({
          ticketType: source.ticketType,
          status: source.status,
          count: source.rows.length,
          statusCode: source.errorCode || null,
          reason: failed ? source.errorMessage : null,
        });
        const now = new Date().toISOString();
        await financeRest('timefit_user_granter_source_snapshots?on_conflict=sync_run_id,source_type', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{
            organization_id: input.organizationId,
            sync_run_id: input.runId,
            requested_scope: input.scope,
            range_from: input.from,
            range_to: input.to,
            source_type: source.ticketType,
            status: source.status,
            api_revision: source.revision,
            row_count: source.rows.length,
            rows_truncated: source.rows.length > SNAPSHOT_ROW_LIMIT,
            payload: source.rows.slice(0, SNAPSHOT_ROW_LIMIT),
            error_code: source.errorCode ? String(source.errorCode) : null,
            error_message: source.errorMessage || null,
            collected_at: now,
            updated_at: now,
          }]),
        });
        if (!failed) {
          await persistGranterFinanceFacts({
            organizationId: input.organizationId,
            runId: input.runId,
            revision: source.revision,
            sourceType: source.ticketType,
            rows: source.rows,
            rangeFrom: input.from,
            rangeTo: input.to,
          });
        }
        await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(input.runId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            completed_sources: statuses.filter(item => item.status === 'loaded').length,
            failed_sources: statuses.filter(item => item.status === 'failed').length,
            source_status: statuses,
            updated_at: now,
          }),
        });
      },
    });
    const existingRows = await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(input.runId)}&select=result_payload&limit=1`).catch(() => []);
    const existingPayload = existingRows[0]?.result_payload || null;
    const currentLoaded = payload.sourceStatus?.filter(item => item.status === 'loaded').length || 0;
    const existingLoaded = existingPayload?.sourceStatus?.filter(item => item.status === 'loaded').length || 0;
    const bestPayload = existingLoaded > currentLoaded ? existingPayload : payload;
    const finishedAt = new Date().toISOString();
    const status = bestPayload.partial ? 'partial' : 'succeeded';
    const storedStatus = status === 'partial' && Number(input.attempt || 1) < 3 ? 'running' : status;
    await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(input.runId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: storedStatus,
        range_from: bestPayload.range?.from || input.from,
        range_to: bestPayload.range?.to || input.to,
        total_sources: GRANTER_FINANCE_TICKET_TYPES.length,
        completed_sources: bestPayload.sourceStatus?.filter(item => item.status === 'loaded').length || 0,
        failed_sources: bestPayload.sourceStatus?.filter(item => item.status === 'failed').length || 0,
        source_status: bestPayload.sourceStatus || statuses,
        result_payload: bestPayload,
        finished_at: storedStatus === 'running' ? null : finishedAt,
        updated_at: finishedAt,
      }),
    });
    if (storedStatus !== 'running') {
      await rebuildProfitSnapshot({ organizationId: input.organizationId, from: input.from, to: input.to });
    }
    console.info('Granter sync step finished', { runId: input.runId, status, attempt: input.attempt });
    return { runId: input.runId, status };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await financeRest(`timefit_user_granter_sync_runs?id=eq.${encode(input.runId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'failed',
        error_code: String(error?.code || error?.status || 'sync_failed').slice(0, 120),
        error_message: String(error?.message || 'Granter sync failed').slice(0, 500),
        source_status: statuses,
        finished_at: finishedAt,
        updated_at: finishedAt,
      }),
    }).catch(() => {});
    console.error('Granter sync step failed', { runId: input.runId, message: error?.message });
    throw error;
  }
}

export async function runGranterFinanceSync(input) {
  'use workflow';
  console.info('Granter workflow started', { runId: input.runId, scope: input.scope });
  let result = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = await executeGranterFinanceSync({ ...input, attempt });
    if (result.status === 'succeeded') return result;
    if (attempt < 3) await sleep('15s');
  }
  return result;
}
