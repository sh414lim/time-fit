create table if not exists public.timefit_user_expense_classification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  match_type text not null check (match_type in ('merchant_business_number','merchant_name')),
  match_value text not null,
  category text not null,
  default_reason text,
  priority integer not null default 100,
  is_active boolean not null default true,
  hit_count integer not null default 0 check (hit_count >= 0),
  last_applied_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, match_type, match_value)
);
create index if not exists timefit_expense_rules_lookup_idx
  on public.timefit_user_expense_classification_rules(organization_id, is_active, priority, match_type);

alter table public.timefit_user_expense_classification_rules enable row level security;
create policy "manager manages expense classification rules" on public.timefit_user_expense_classification_rules
  for all using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select, insert, update, delete on public.timefit_user_expense_classification_rules to authenticated;

alter table public.timefit_user_expenses
  add column if not exists classification_rule_id uuid references public.timefit_user_expense_classification_rules(id) on delete set null;

select pg_notify('pgrst','reload schema');
