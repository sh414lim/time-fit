create table if not exists public.timefit_user_payroll_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  pay_type public.timefit_user_pay_type not null,
  hourly_wage numeric(14,2),
  daily_wage numeric(14,2),
  monthly_salary numeric(14,2),
  effective_from date not null,
  effective_to date,
  memo text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check ((pay_type = 'hourly' and coalesce(hourly_wage, 0) > 0) or (pay_type = 'daily' and coalesce(daily_wage, 0) > 0) or (pay_type = 'monthly' and coalesce(monthly_salary, 0) > 0))
);

create index if not exists timefit_payroll_contracts_staff_effective_idx on public.timefit_user_payroll_contracts(staff_id, effective_from desc);

insert into public.timefit_user_payroll_contracts(organization_id, staff_id, pay_type, hourly_wage, daily_wage, monthly_salary, effective_from, memo)
select organization_id, id, pay_type, hourly_wage, daily_wage, monthly_salary, coalesce(joined_on, current_date), '기존 직원 정보에서 생성된 초기 계약'
from public.timefit_user_staff s
where (pay_type = 'hourly' and coalesce(hourly_wage, 0) > 0) or (pay_type = 'daily' and coalesce(daily_wage, 0) > 0) or (pay_type = 'monthly' and coalesce(monthly_salary, 0) > 0)
on conflict do nothing;

create table if not exists public.timefit_user_payroll_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  settlement_month date not null check (settlement_month = date_trunc('month', settlement_month)::date),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'closed', 'reopen_required')),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, settlement_month)
);

create table if not exists public.timefit_user_payroll_draft_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_draft_id uuid not null references public.timefit_user_payroll_drafts(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  pay_type public.timefit_user_pay_type not null,
  applied_rate numeric(14,2) not null default 0,
  scheduled_minutes integer not null default 0,
  worked_minutes integer not null default 0,
  completed_work_days numeric(7,2) not null default 0,
  approved_leave_days numeric(7,2) not null default 0,
  base_pay numeric(14,2) not null default 0,
  adjustment_amount numeric(14,2) not null default 0,
  adjustment_memo text,
  estimated_total numeric(14,2) not null default 0,
  calculation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_draft_id, staff_id)
);

alter table public.timefit_user_payroll_contracts enable row level security;
alter table public.timefit_user_payroll_drafts enable row level security;
alter table public.timefit_user_payroll_draft_lines enable row level security;

create policy "manager manages payroll contracts" on public.timefit_user_payroll_contracts for all using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[])) with check (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "manager manages payroll drafts" on public.timefit_user_payroll_drafts for all using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[])) with check (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "manager manages payroll draft lines" on public.timefit_user_payroll_draft_lines for all using (exists (select 1 from public.timefit_user_payroll_drafts d where d.id = payroll_draft_id and public.timefit_user_has_membership_role(d.organization_id, array['manager']::public.timefit_user_role[]))) with check (exists (select 1 from public.timefit_user_payroll_drafts d where d.id = payroll_draft_id and public.timefit_user_has_membership_role(d.organization_id, array['manager']::public.timefit_user_role[])));

grant select, insert, update, delete on public.timefit_user_payroll_contracts, public.timefit_user_payroll_drafts, public.timefit_user_payroll_draft_lines to authenticated;
select pg_notify('pgrst', 'reload schema');
