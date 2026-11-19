create table if not exists public.timefit_user_granter_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  requested_by uuid,
  requested_scope text not null check (requested_scope in ('period', 'all')),
  range_from date not null,
  range_to date not null,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  workflow_run_id text,
  total_sources integer not null default 12 check (total_sources >= 0),
  completed_sources integer not null default 0 check (completed_sources >= 0),
  failed_sources integer not null default 0 check (failed_sources >= 0),
  source_status jsonb not null default '[]'::jsonb,
  result_payload jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  check (range_to >= range_from),
  check (completed_sources + failed_sources <= total_sources)
);

create index if not exists timefit_user_granter_sync_runs_latest_idx
  on public.timefit_user_granter_sync_runs
  (organization_id, requested_scope, range_from, range_to, finished_at desc nulls last);

create index if not exists timefit_user_granter_sync_runs_status_idx
  on public.timefit_user_granter_sync_runs
  (status, created_at desc);

create table if not exists public.timefit_user_granter_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  sync_run_id uuid not null references public.timefit_user_granter_sync_runs(id) on delete cascade,
  requested_scope text not null check (requested_scope in ('period', 'all')),
  range_from date not null,
  range_to date not null,
  source_type text not null,
  status text not null check (status in ('loaded', 'failed')),
  api_revision text,
  row_count integer not null default 0 check (row_count >= 0),
  rows_truncated boolean not null default false,
  payload jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sync_run_id, source_type),
  check (range_to >= range_from)
);

create index if not exists timefit_user_granter_source_snapshots_lookup_idx
  on public.timefit_user_granter_source_snapshots
  (organization_id, requested_scope, range_from, range_to, source_type, collected_at desc);

alter table public.timefit_user_granter_sync_runs enable row level security;
alter table public.timefit_user_granter_source_snapshots enable row level security;

drop policy if exists timefit_user_granter_sync_runs_service on public.timefit_user_granter_sync_runs;
create policy timefit_user_granter_sync_runs_service
  on public.timefit_user_granter_sync_runs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists timefit_user_granter_source_snapshots_service on public.timefit_user_granter_source_snapshots;
create policy timefit_user_granter_source_snapshots_service
  on public.timefit_user_granter_source_snapshots
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.timefit_user_granter_sync_runs from anon, authenticated;
revoke all on table public.timefit_user_granter_source_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.timefit_user_granter_sync_runs to service_role;
grant select, insert, update, delete on table public.timefit_user_granter_source_snapshots to service_role;

select pg_notify('pgrst', 'reload schema');

