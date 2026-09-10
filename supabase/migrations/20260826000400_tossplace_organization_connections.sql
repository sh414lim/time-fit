-- Each TimeFit workplace owns a non-secret Toss Place connection record.
-- The Toss API credentials remain only in Vercel server environment variables.
create table if not exists public.timefit_user_tossplace_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.timefit_user_organizations(id) on delete cascade,
  display_name text not null default 'Toss Place',
  service_id text not null,
  service_code text not null,
  merchant_id bigint,
  sync_enabled boolean not null default true,
  connection_status text not null default 'pending' check (connection_status in ('pending','connected','disabled','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(service_id)) between 2 and 120),
  check (char_length(trim(service_code)) between 4 and 120)
);

create trigger timefit_user_tossplace_connections_updated_at
before update on public.timefit_user_tossplace_connections
for each row execute procedure public.set_updated_at();

alter table public.timefit_user_tossplace_connections enable row level security;
create policy "manager manages tossplace connections"
  on public.timefit_user_tossplace_connections for all
  using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select, insert, update, delete on public.timefit_user_tossplace_connections to authenticated;

-- Sales remain server-only. Organization ownership lets one TimeFit instance
-- synchronize multiple independently linked Toss Place stores safely.
alter table public.tossplace_orders add column if not exists organization_id uuid references public.timefit_user_organizations(id) on delete set null;
alter table public.tossplace_sync_state add column if not exists organization_id uuid references public.timefit_user_organizations(id) on delete set null;
create index if not exists tossplace_orders_organization_completed_idx on public.tossplace_orders(organization_id, completed_at desc);

select pg_notify('pgrst', 'reload schema');
