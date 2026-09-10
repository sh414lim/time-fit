create table if not exists public.timefit_user_corporate_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  issuer text not null,
  nickname text not null,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  holder_staff_id uuid references public.timefit_user_staff(id) on delete set null,
  status text not null default 'active' check (status in ('active','paused','disconnected')),
  provider text not null default 'manual',
  provider_card_token text,
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, issuer, last4)
);

create table if not exists public.timefit_user_card_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  corporate_card_id uuid not null references public.timefit_user_corporate_cards(id) on delete cascade,
  source text not null default 'csv' check (source in ('csv','api','manual')),
  source_transaction_id text,
  approved_at timestamptz not null,
  merchant_name text not null,
  amount bigint not null check (amount >= 0),
  transaction_type text not null default 'approval' check (transaction_type in ('approval','cancellation')),
  approval_number text,
  memo text,
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (corporate_card_id, source, source_transaction_id)
);

create unique index if not exists timefit_card_transactions_fingerprint_unique
  on public.timefit_user_card_transactions(corporate_card_id, approved_at, amount, transaction_type, coalesce(approval_number,''), merchant_name);
create index if not exists timefit_corporate_cards_org_idx
  on public.timefit_user_corporate_cards(organization_id, status, created_at desc);
create index if not exists timefit_card_transactions_org_date_idx
  on public.timefit_user_card_transactions(organization_id, approved_at desc);

alter table public.timefit_user_corporate_cards enable row level security;
alter table public.timefit_user_card_transactions enable row level security;

create policy "manager manages corporate cards" on public.timefit_user_corporate_cards
  for all using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
create policy "manager manages card transactions" on public.timefit_user_card_transactions
  for all using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));

grant select, insert, update, delete on public.timefit_user_corporate_cards to authenticated;
grant select, insert, update, delete on public.timefit_user_card_transactions to authenticated;

select pg_notify('pgrst','reload schema');
