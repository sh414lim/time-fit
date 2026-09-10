alter table public.timefit_user_organization_settings
  add column if not exists accountant_email text;

create table if not exists public.timefit_user_settlement_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  settlement_month date not null,
  recipient_email text not null,
  status text not null check (status in ('sent', 'failed')),
  sales_amount numeric(14,2) not null default 0,
  completed_order_count integer not null default 0,
  document_count integer not null default 0,
  provider_message_id text,
  error_message text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists timefit_settlement_deliveries_org_month_idx
  on public.timefit_user_settlement_deliveries(organization_id, settlement_month desc, created_at desc);

alter table public.timefit_user_settlement_deliveries enable row level security;
create policy "manager reads settlement delivery logs" on public.timefit_user_settlement_deliveries
  for select using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));

grant select on public.timefit_user_settlement_deliveries to authenticated;
select pg_notify('pgrst', 'reload schema');
