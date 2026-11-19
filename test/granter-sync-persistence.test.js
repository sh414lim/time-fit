import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicGranterSyncRun } from '../server/api/_granter-sync-store.js';

test('Granter sync status never exposes the persisted analytics payload', () => {
  const run = publicGranterSyncRun({ id: 'run-1', status: 'running', result_payload: { transactions: [{ id: 'secret-row' }] } });
  assert.equal(run.id, 'run-1');
  assert.equal(run.hasSnapshot, true);
  assert.equal('result_payload' in run, false);
});

test('Granter sync tables are server-only and protected by RLS', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261119072229_granter_progressive_sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.timefit_user_granter_sync_runs from anon, authenticated/i);
  assert.match(sql, /to service_role/i);
});

test('Granter long-running collection is registered as a durable workflow', async () => {
  const source = await readFile(new URL('../workflows/granter-finance-sync.js', import.meta.url), 'utf8');
  assert.match(source, /['"]use workflow['"]/);
  assert.match(source, /['"]use step['"]/);
  assert.match(source, /onSourceSettled/);
});
