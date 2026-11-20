create table if not exists public.timefit_user_finance_category_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  source_system text not null check (source_system in ('granter', 'timefit')),
  source_category_id text not null,
  source_category_name text not null,
  profit_bucket text not null check (profit_bucket in ('revenue', 'purchase_cost', 'labor', 'opex', 'tax', 'finance', 'asset', 'transfer', 'excluded', 'unclassified')),
  include_in_profit boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_system, source_category_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists timefit_finance_category_mappings_lookup_idx
  on public.timefit_user_finance_category_mappings
  (organization_id, source_system, source_category_id, effective_from desc);

create table if not exists public.timefit_user_finance_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  source_system text not null check (source_system in ('granter', 'timefit', 'tossplace')),
  source_type text not null,
  source_id text not null,
  sync_run_id uuid references public.timefit_user_granter_sync_runs(id) on delete set null,
  occurred_on date not null,
  direction text not null check (direction in ('in', 'out')),
  amount bigint not null check (amount >= 0),
  currency text not null default 'KRW',
  content text,
  contact_name text,
  business_number text,
  asset_id text,
  asset_name text,
  source_category_id text,
  source_category_name text,
  source_category_series text,
  profit_bucket text not null default 'unclassified'
    check (profit_bucket in ('revenue', 'purchase_cost', 'labor', 'opex', 'tax', 'finance', 'asset', 'transfer', 'excluded', 'unclassified')),
  include_in_profit boolean not null default true,
  is_provisional boolean not null default false,
  is_source_included boolean not null default true,
  source_revision text,
  tags jsonb not null default '[]'::jsonb,
  raw_summary jsonb not null default '{}'::jsonb,
  source_hash text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_system, source_type, source_id)
);

create index if not exists timefit_finance_facts_org_date_idx
  on public.timefit_user_finance_facts
  (organization_id, occurred_on desc, profit_bucket);

create index if not exists timefit_finance_facts_sync_run_idx
  on public.timefit_user_finance_facts
  (sync_run_id, source_type);

create index if not exists timefit_finance_facts_unclassified_idx
  on public.timefit_user_finance_facts
  (organization_id, occurred_on desc)
  where profit_bucket = 'unclassified' and is_source_included = true;

create table if not exists public.timefit_user_profit_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  snapshot_key text not null,
  period_start date not null,
  period_end date not null,
  group_by text not null default 'day' check (group_by in ('day', 'week', 'month')),
  status text not null check (status in ('actual', 'provisional', 'incomplete')),
  calculation_version text not null,
  totals jsonb not null default '{}'::jsonb,
  series jsonb not null default '[]'::jsonb,
  breakdown jsonb not null default '{}'::jsonb,
  completeness jsonb not null default '{}'::jsonb,
  source_versions jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, snapshot_key),
  check (period_end >= period_start)
);

create index if not exists timefit_profit_snapshots_latest_idx
  on public.timefit_user_profit_snapshots
  (organization_id, period_start, period_end, group_by, generated_at desc);

alter table public.timefit_user_finance_category_mappings enable row level security;
alter table public.timefit_user_finance_facts enable row level security;
alter table public.timefit_user_profit_snapshots enable row level security;

drop policy if exists timefit_finance_category_mappings_service on public.timefit_user_finance_category_mappings;
create policy timefit_finance_category_mappings_service
  on public.timefit_user_finance_category_mappings
  for all to service_role using (true) with check (true);

drop policy if exists timefit_finance_facts_service on public.timefit_user_finance_facts;
create policy timefit_finance_facts_service
  on public.timefit_user_finance_facts
  for all to service_role using (true) with check (true);

drop policy if exists timefit_profit_snapshots_service on public.timefit_user_profit_snapshots;
create policy timefit_profit_snapshots_service
  on public.timefit_user_profit_snapshots
  for all to service_role using (true) with check (true);

revoke all on table public.timefit_user_finance_category_mappings from anon, authenticated;
revoke all on table public.timefit_user_finance_facts from anon, authenticated;
revoke all on table public.timefit_user_profit_snapshots from anon, authenticated;
grant select, insert, update, delete on table public.timefit_user_finance_category_mappings to service_role;
grant select, insert, update, delete on table public.timefit_user_finance_facts to service_role;
grant select, insert, update, delete on table public.timefit_user_profit_snapshots to service_role;

select pg_notify('pgrst', 'reload schema');
