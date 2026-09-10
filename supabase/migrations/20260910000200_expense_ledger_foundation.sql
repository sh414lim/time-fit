-- Sprint 1: durable card connections, immutable transaction events and a
-- single expense/closeout ledger. This migration is backward-compatible with
-- the existing manual card and CSV transaction tables.

alter table public.timefit_user_corporate_cards
  add column if not exists provider_card_id text,
  add column if not exists connection_id uuid,
  add column if not exists archived_at timestamptz;

alter table public.timefit_user_corporate_cards
  drop constraint if exists timefit_user_corporate_cards_organization_id_issuer_last4_key;

create unique index if not exists timefit_corporate_cards_provider_id_unique
  on public.timefit_user_corporate_cards(organization_id, provider, provider_card_id)
  where provider_card_id is not null;

create index if not exists timefit_corporate_cards_manual_lookup_idx
  on public.timefit_user_corporate_cards(organization_id, issuer, last4)
  where provider = 'manual' and archived_at is null;

alter table public.timefit_user_card_transactions
  drop constraint if exists timefit_user_card_transactions_corporate_card_id_fkey;
alter table public.timefit_user_card_transactions
  add constraint timefit_user_card_transactions_corporate_card_id_fkey
  foreign key (corporate_card_id) references public.timefit_user_corporate_cards(id) on delete restrict;

create table if not exists public.timefit_user_card_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  provider text not null,
  business_type text not null default 'corporation' check (business_type in ('corporation','sole_proprietor')),
  status text not null default 'draft' check (status in ('draft','authenticating','backfilling','reconciling','active','degraded','reauth_required','paused','disconnected')),
  credential_reference_encrypted text,
  consent_version text,
  consented_by uuid references auth.users(id) on delete set null,
  consented_at timestamptz,
  last_attempted_at timestamptz,
  last_succeeded_at timestamptz,
  next_sync_at timestamptz,
  last_error_code text,
  last_error_category text check (last_error_category is null or last_error_category in ('authentication','provider_maintenance','rate_limit','invalid_request','partial_response','network','unknown')),
  disconnected_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists timefit_card_connections_active_provider_unique
  on public.timefit_user_card_connections(organization_id, provider)
  where status <> 'disconnected';
create index if not exists timefit_card_connections_due_idx
  on public.timefit_user_card_connections(status, next_sync_at)
  where status in ('active','degraded');

alter table public.timefit_user_corporate_cards
  drop constraint if exists timefit_user_corporate_cards_connection_id_fkey;
alter table public.timefit_user_corporate_cards
  add constraint timefit_user_corporate_cards_connection_id_fkey
  foreign key (connection_id) references public.timefit_user_card_connections(id) on delete set null;

create table if not exists public.timefit_user_connection_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  connection_id uuid not null references public.timefit_user_card_connections(id) on delete restrict,
  corporate_card_id uuid references public.timefit_user_corporate_cards(id) on delete set null,
  provider_asset_id text not null,
  asset_type text not null default 'corporate_card' check (asset_type in ('corporate_card')),
  display_name text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  status text not null default 'discovered' check (status in ('discovered','selected','excluded','disconnected')),
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, provider_asset_id)
);

create table if not exists public.timefit_user_card_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  connection_id uuid not null references public.timefit_user_card_connections(id) on delete restrict,
  corporate_card_id uuid references public.timefit_user_corporate_cards(id) on delete set null,
  sync_type text not null check (sync_type in ('cards','approvals','acquisitions','billing','reconciliation')),
  range_from timestamptz,
  range_to timestamptz,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  request_count integer not null default 0 check (request_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  estimated_cost numeric(14,4),
  error_code text,
  error_category text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists timefit_card_sync_runs_queue_idx
  on public.timefit_user_card_sync_runs(status, created_at)
  where status in ('queued','running');

create table if not exists public.timefit_user_card_sync_cursors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  connection_id uuid not null references public.timefit_user_card_connections(id) on delete restrict,
  corporate_card_id uuid references public.timefit_user_corporate_cards(id) on delete cascade,
  sync_type text not null,
  cursor_value text,
  succeeded_through timestamptz,
  updated_at timestamptz not null default now(),
  unique (connection_id, corporate_card_id, sync_type)
);

create table if not exists public.timefit_user_card_transaction_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  corporate_card_id uuid not null references public.timefit_user_corporate_cards(id) on delete restrict,
  provider_group_key text,
  legacy_transaction_id uuid references public.timefit_user_card_transactions(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','acquired','cancelled','partially_cancelled','billed')),
  approved_amount bigint not null default 0 check (approved_amount >= 0),
  acquired_amount bigint not null default 0 check (acquired_amount >= 0),
  cancelled_amount bigint not null default 0 check (cancelled_amount >= 0),
  net_amount bigint not null default 0,
  currency text not null default 'KRW',
  approval_number text,
  approved_at timestamptz,
  acquired_at timestamptz,
  billed_at timestamptz,
  merchant_name text,
  merchant_business_number text,
  reconciliation_status text not null default 'unreviewed' check (reconciliation_status in ('unreviewed','matched','review_required','excluded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists timefit_card_groups_provider_key_unique
  on public.timefit_user_card_transaction_groups(organization_id, corporate_card_id, provider_group_key)
  where provider_group_key is not null;
create unique index if not exists timefit_card_groups_legacy_unique
  on public.timefit_user_card_transaction_groups(legacy_transaction_id)
  where legacy_transaction_id is not null;
create index if not exists timefit_card_groups_org_date_idx
  on public.timefit_user_card_transaction_groups(organization_id, approved_at desc);

create table if not exists public.timefit_user_card_transaction_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  transaction_group_id uuid references public.timefit_user_card_transaction_groups(id) on delete restrict,
  corporate_card_id uuid not null references public.timefit_user_corporate_cards(id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  event_type text not null check (event_type in ('approval','cancellation','partial_cancellation','acquisition','billing','payment')),
  occurred_at timestamptz not null,
  amount bigint not null check (amount >= 0),
  currency text not null default 'KRW',
  approval_number text,
  original_provider_event_id text,
  merchant_name text,
  merchant_business_number text,
  raw_checksum text,
  raw_payload_path text,
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, provider, provider_event_id)
);
create index if not exists timefit_card_events_group_idx
  on public.timefit_user_card_transaction_events(transaction_group_id, occurred_at);

create table if not exists public.timefit_user_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  ledger_entry_id uuid not null default gen_random_uuid(),
  transaction_date date not null,
  supply_amount bigint,
  vat_amount bigint,
  total_amount bigint not null check (total_amount >= 0),
  currency text not null default 'KRW',
  merchant_name text,
  merchant_business_number text,
  category text,
  reason text,
  staff_id uuid references public.timefit_user_staff(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','review_required','confirmed','excluded','adjusted')),
  source_confidence numeric(5,4),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ledger_entry_id),
  check (supply_amount is null or supply_amount >= 0),
  check (vat_amount is null or vat_amount >= 0),
  check (supply_amount is null or vat_amount is null or supply_amount + vat_amount = total_amount)
);
create index if not exists timefit_expenses_org_date_idx
  on public.timefit_user_expenses(organization_id, transaction_date desc, status);

create table if not exists public.timefit_user_expense_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  expense_id uuid not null references public.timefit_user_expenses(id) on delete restrict,
  source_type text not null check (source_type in ('receipt','card_transaction_group','email','csv','tax_invoice','manual')),
  source_id text not null,
  is_primary boolean not null default false,
  match_reason jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, source_type, source_id)
);

create table if not exists public.timefit_user_expense_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  expense_id uuid references public.timefit_user_expenses(id) on delete cascade,
  transaction_group_id uuid references public.timefit_user_card_transaction_groups(id) on delete cascade,
  document_id uuid references public.timefit_user_finance_documents(id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested','confirmed','rejected','unlinked')),
  score integer not null default 0 check (score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (transaction_group_id is not null or document_id is not null)
);

create table if not exists public.timefit_user_closeouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  period_type text not null check (period_type in ('daily','weekly','monthly','annual')),
  period_start date not null,
  period_end date not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','ready','closed','reopened')),
  source_cutoff_at timestamptz,
  net_sales bigint not null default 0,
  operating_expenses bigint not null default 0,
  labor_cost bigint not null default 0,
  operating_profit bigint not null default 0,
  adjustments bigint not null default 0,
  summary jsonb not null default '{}'::jsonb,
  checksum text,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_type, period_start, period_end, version),
  check (period_start <= period_end)
);

create table if not exists public.timefit_user_closeout_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  closeout_id uuid not null references public.timefit_user_closeouts(id) on delete restrict,
  line_type text not null,
  dimension_type text,
  dimension_key text,
  amount bigint not null,
  count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists timefit_closeouts_org_period_idx
  on public.timefit_user_closeouts(organization_id, period_start desc, period_type, status);

create table if not exists public.timefit_user_expense_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  source text not null default 'user',
  created_at timestamptz not null default now()
);
create index if not exists timefit_expense_audit_entity_idx
  on public.timefit_user_expense_audit_logs(organization_id, entity_type, entity_id, created_at desc);

-- Preserve the existing CSV rows as immutable legacy events/groups. No expense
-- is auto-confirmed here; a manager must review it in the new ledger workflow.
insert into public.timefit_user_card_transaction_groups (
  organization_id, corporate_card_id, legacy_transaction_id, status,
  approved_amount, cancelled_amount, net_amount, approval_number,
  approved_at, merchant_name, reconciliation_status, created_at, updated_at
)
select
  t.organization_id,
  t.corporate_card_id,
  t.id,
  case when t.transaction_type = 'cancellation' then 'cancelled' else 'pending' end,
  case when t.transaction_type = 'approval' then t.amount else 0 end,
  case when t.transaction_type = 'cancellation' then t.amount else 0 end,
  case when t.transaction_type = 'cancellation' then -t.amount else t.amount end,
  t.approval_number,
  t.approved_at,
  t.merchant_name,
  'unreviewed',
  t.created_at,
  t.created_at
from public.timefit_user_card_transactions t
on conflict (legacy_transaction_id) where legacy_transaction_id is not null do nothing;

insert into public.timefit_user_card_transaction_events (
  organization_id, transaction_group_id, corporate_card_id, provider,
  provider_event_id, event_type, occurred_at, amount, approval_number,
  merchant_name, imported_by, created_at
)
select
  t.organization_id,
  g.id,
  t.corporate_card_id,
  t.source,
  coalesce(t.source_transaction_id, 'legacy:' || t.id::text),
  case when t.transaction_type = 'cancellation' then 'cancellation' else 'approval' end,
  t.approved_at,
  t.amount,
  t.approval_number,
  t.merchant_name,
  t.imported_by,
  t.created_at
from public.timefit_user_card_transactions t
join public.timefit_user_card_transaction_groups g on g.legacy_transaction_id = t.id
on conflict (organization_id, provider, provider_event_id) do nothing;

alter table public.timefit_user_card_connections enable row level security;
alter table public.timefit_user_connection_assets enable row level security;
alter table public.timefit_user_card_sync_runs enable row level security;
alter table public.timefit_user_card_sync_cursors enable row level security;
alter table public.timefit_user_card_transaction_groups enable row level security;
alter table public.timefit_user_card_transaction_events enable row level security;
alter table public.timefit_user_expenses enable row level security;
alter table public.timefit_user_expense_sources enable row level security;
alter table public.timefit_user_expense_matches enable row level security;
alter table public.timefit_user_closeouts enable row level security;
alter table public.timefit_user_closeout_lines enable row level security;
alter table public.timefit_user_expense_audit_logs enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'timefit_user_card_connections','timefit_user_connection_assets',
    'timefit_user_card_sync_runs','timefit_user_card_sync_cursors',
    'timefit_user_card_transaction_groups','timefit_user_card_transaction_events',
    'timefit_user_expenses','timefit_user_expense_sources',
    'timefit_user_expense_matches','timefit_user_closeouts',
    'timefit_user_closeout_lines','timefit_user_expense_audit_logs'
  ] loop
    execute format('drop policy if exists "manager accesses finance ledger" on public.%I', table_name);
    execute format(
      'create policy "manager accesses finance ledger" on public.%I for all using (public.timefit_user_has_membership_role(organization_id,array[''manager'']::public.timefit_user_role[])) with check (public.timefit_user_has_membership_role(organization_id,array[''manager'']::public.timefit_user_role[]))',
      table_name
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

create or replace function public.timefit_user_disconnect_corporate_card(p_card_id uuid)
returns public.timefit_user_corporate_cards
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.timefit_user_corporate_cards;
begin
  select * into v_card from public.timefit_user_corporate_cards where id = p_card_id for update;
  if v_card.id is null then raise exception 'card_not_found'; end if;
  if not public.timefit_user_has_membership_role(v_card.organization_id,array['manager']::public.timefit_user_role[]) then
    raise exception 'forbidden';
  end if;
  update public.timefit_user_corporate_cards
    set status = 'disconnected', provider_card_token = null, archived_at = now(), updated_at = now()
    where id = p_card_id returning * into v_card;
  insert into public.timefit_user_expense_audit_logs(organization_id, entity_type, entity_id, action, after_value, actor_id)
    values(v_card.organization_id, 'corporate_card', v_card.id, 'disconnected', jsonb_build_object('status',v_card.status,'archived_at',v_card.archived_at), auth.uid());
  return v_card;
end $$;

revoke all on function public.timefit_user_disconnect_corporate_card(uuid) from public;
grant execute on function public.timefit_user_disconnect_corporate_card(uuid) to authenticated;

select pg_notify('pgrst','reload schema');
