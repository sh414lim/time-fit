-- TimeFit core schema for Supabase PostgreSQL
create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'admin', 'manager', 'employee');
create type public.employee_status as enum ('active', 'leave_of_absence', 'terminated');
create type public.employment_type as enum ('hourly', 'salaried', 'daily', 'contractor');
create type public.schedule_status as enum ('draft', 'published', 'cancelled');
create type public.attendance_status as enum ('scheduled', 'working', 'completed', 'late', 'absent', 'on_leave', 'correction_pending');
create type public.leave_unit as enum ('day', 'half_day', 'hour');
create type public.leave_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.payroll_run_status as enum ('draft', 'reviewing', 'closed', 'published');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_number text unique,
  timezone text not null default 'Asia/Seoul',
  currency text not null default 'KRW',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workplaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  role public.member_role not null default 'employee',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  user_id uuid unique references auth.users(id) on delete set null,
  employee_no text,
  name text not null,
  phone text,
  email text,
  department text,
  job_title text,
  joined_on date not null,
  terminated_on date,
  status public.employee_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, employee_no)
);

create table public.employment_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  employment_type public.employment_type not null,
  started_on date not null,
  ended_on date,
  hourly_wage numeric(14,2),
  monthly_salary numeric(14,2),
  daily_wage numeric(14,2),
  weekly_hours integer default 40 check (weekly_hours between 0 and 168),
  standard_minutes integer default 480 check (standard_minutes >= 0),
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_current_contract_per_employee on public.employment_contracts(employee_id) where is_current;

create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  work_date date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  shift_name text,
  is_day_off boolean not null default false,
  status public.schedule_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date),
  check ((is_day_off and starts_at is null and ends_at is null) or (not is_day_off and starts_at < ends_at))
);
create index work_schedules_organization_date on public.work_schedules(organization_id, work_date);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  work_date date not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  night_minutes integer not null default 0 check (night_minutes >= 0),
  holiday_minutes integer not null default 0 check (holiday_minutes >= 0),
  status public.attendance_status not null default 'scheduled',
  check_in_latitude numeric(10,7),
  check_in_longitude numeric(10,7),
  check_out_latitude numeric(10,7),
  check_out_longitude numeric(10,7),
  correction_reason text,
  correction_requested_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index attendance_organization_date on public.attendance_records(organization_id, work_date);

create table public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  unit public.leave_unit not null default 'day',
  is_paid boolean not null default true,
  requires_approval boolean not null default true,
  annual_grant_amount numeric(5,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_policy_id uuid not null references public.leave_policies(id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  granted_amount numeric(5,2) not null default 0,
  carried_amount numeric(5,2) not null default 0,
  used_amount numeric(5,2) not null default 0,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_policy_id, year)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_policy_id uuid not null references public.leave_policies(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  amount numeric(5,2) not null check (amount > 0),
  reason text,
  status public.leave_request_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at <= ends_at)
);
create index leave_requests_employee_status on public.leave_requests(employee_id, status);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  month integer not null check (month between 1 and 12),
  period_start date not null,
  period_end date not null,
  status public.payroll_run_status not null default 'draft',
  closed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, year, month),
  check (period_start <= period_end)
);

create table public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  regular_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  night_minutes integer not null default 0,
  holiday_minutes integer not null default 0,
  base_pay numeric(14,2) not null default 0,
  allowance_pay numeric(14,2) not null default 0,
  overtime_pay numeric(14,2) not null default 0,
  deduction_pay numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id)
);

create table public.qr_attendance_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workplace_id uuid not null references public.workplaces(id) on delete cascade,
  token_hash text not null unique,
  work_date date not null,
  expires_at timestamptz not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index qr_tokens_lookup on public.qr_attendance_tokens(workplace_id, work_date, expires_at) where is_active;

create table public.approval_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute procedure public.set_updated_at();
create trigger workplaces_updated_at before update on public.workplaces for each row execute procedure public.set_updated_at();
create trigger employees_updated_at before update on public.employees for each row execute procedure public.set_updated_at();
create trigger schedules_updated_at before update on public.work_schedules for each row execute procedure public.set_updated_at();
create trigger attendance_updated_at before update on public.attendance_records for each row execute procedure public.set_updated_at();
create trigger leave_policies_updated_at before update on public.leave_policies for each row execute procedure public.set_updated_at();
create trigger leave_balances_updated_at before update on public.leave_balances for each row execute procedure public.set_updated_at();
create trigger leave_requests_updated_at before update on public.leave_requests for each row execute procedure public.set_updated_at();
create trigger payroll_runs_updated_at before update on public.payroll_runs for each row execute procedure public.set_updated_at();
create trigger payroll_items_updated_at before update on public.payroll_items for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email)); return new; end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_organization_member(target_organization uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members where organization_id = target_organization and user_id = auth.uid());
$$;
create or replace function public.has_organization_role(target_organization uuid, allowed public.member_role[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.organization_members where organization_id = target_organization and user_id = auth.uid() and role = any(allowed));
$$;
create or replace function public.current_employee_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() and status = 'active' limit 1;
$$;
create or replace function public.bootstrap_organization(p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare v_organization_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  insert into public.organizations (name) values (trim(p_name)) returning id into v_organization_id;
  insert into public.organization_members (organization_id, user_id, role) values (v_organization_id, auth.uid(), 'owner');
  return v_organization_id;
end;
$$;
grant execute on function public.bootstrap_organization(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.workplaces enable row level security;
alter table public.organization_members enable row level security;
alter table public.employees enable row level security;
alter table public.employment_contracts enable row level security;
alter table public.work_schedules enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_policies enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_items enable row level security;
alter table public.qr_attendance_tokens enable row level security;
alter table public.approval_logs enable row level security;

create policy "profile self read" on public.profiles for select using (id = auth.uid());
create policy "profile self update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "organization member read" on public.organizations for select using (public.is_organization_member(id));
create policy "manager manages organizations" on public.organizations for all using (public.has_organization_role(id, array['owner','admin']::public.member_role[]));
create policy "member reads workplaces" on public.workplaces for select using (public.is_organization_member(organization_id));
create policy "manager manages workplaces" on public.workplaces for all using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "member reads memberships" on public.organization_members for select using (public.is_organization_member(organization_id));
create policy "owner manages memberships" on public.organization_members for all using (public.has_organization_role(organization_id, array['owner','admin']::public.member_role[]));
create policy "member reads employees" on public.employees for select using (public.is_organization_member(organization_id));
create policy "manager manages employees" on public.employees for all using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "manager reads contracts" on public.employment_contracts for select using (exists(select 1 from public.employees e where e.id = employee_id and public.has_organization_role(e.organization_id, array['owner','admin','manager']::public.member_role[])));
create policy "manager manages contracts" on public.employment_contracts for all using (exists(select 1 from public.employees e where e.id = employee_id and public.has_organization_role(e.organization_id, array['owner','admin']::public.member_role[])));
create policy "schedule member read" on public.work_schedules for select using (public.is_organization_member(organization_id));
create policy "manager manages schedules" on public.work_schedules for all using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "attendance member read" on public.attendance_records for select using (public.is_organization_member(organization_id));
create policy "manager manages attendance" on public.attendance_records for all using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "leave policy member read" on public.leave_policies for select using (public.is_organization_member(organization_id));
create policy "manager manages leave policies" on public.leave_policies for all using (public.has_organization_role(organization_id, array['owner','admin']::public.member_role[]));
create policy "leave balance self or manager read" on public.leave_balances for select using (employee_id = public.current_employee_id() or exists(select 1 from public.employees e where e.id = employee_id and public.has_organization_role(e.organization_id, array['owner','admin','manager']::public.member_role[])));
create policy "leave request self read" on public.leave_requests for select using (employee_id = public.current_employee_id() or public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "employee creates own leave request" on public.leave_requests for insert with check (employee_id = public.current_employee_id() and public.is_organization_member(organization_id));
create policy "manager updates leave request" on public.leave_requests for update using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "manager reads payroll runs" on public.payroll_runs for select using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "owner manages payroll runs" on public.payroll_runs for all using (public.has_organization_role(organization_id, array['owner','admin']::public.member_role[]));
create policy "payroll self or manager read" on public.payroll_items for select using (employee_id = public.current_employee_id() or exists(select 1 from public.payroll_runs p where p.id = payroll_run_id and public.has_organization_role(p.organization_id, array['owner','admin','manager']::public.member_role[])));
create policy "manager manages payroll items" on public.payroll_items for all using (exists(select 1 from public.payroll_runs p where p.id = payroll_run_id and public.has_organization_role(p.organization_id, array['owner','admin']::public.member_role[])));
create policy "manager manages qr tokens" on public.qr_attendance_tokens for all using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "manager reads approval logs" on public.approval_logs for select using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));

create or replace function public.record_qr_attendance(p_token text, p_action text, p_latitude numeric default null, p_longitude numeric default null)
returns public.attendance_records language plpgsql security definer set search_path = public as $$
declare v_employee public.employees; v_token public.qr_attendance_tokens; v_record public.attendance_records; v_now timestamptz := now();
begin
  if p_action not in ('check_in', 'check_out') then raise exception 'invalid_action'; end if;
  select * into v_employee from public.employees where user_id = auth.uid() and status = 'active' limit 1;
  if v_employee.id is null then raise exception 'employee_not_found'; end if;
  select * into v_token from public.qr_attendance_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex') and is_active and expires_at > v_now and work_date = (v_now at time zone 'Asia/Seoul')::date limit 1;
  if v_token.id is null then raise exception 'invalid_or_expired_qr'; end if;
  if v_employee.organization_id <> v_token.organization_id then raise exception 'organization_mismatch'; end if;
  if v_employee.workplace_id is not null and v_employee.workplace_id <> v_token.workplace_id then raise exception 'wrong_workplace'; end if;
  select * into v_record from public.attendance_records where employee_id = v_employee.id and work_date = v_token.work_date for update;
  if p_action = 'check_in' then
    if v_record.id is not null and v_record.checked_in_at is not null then raise exception 'already_checked_in'; end if;
    insert into public.attendance_records (organization_id, employee_id, workplace_id, work_date, checked_in_at, check_in_latitude, check_in_longitude, status)
    values (v_employee.organization_id, v_employee.id, v_token.workplace_id, v_token.work_date, v_now, p_latitude, p_longitude, 'working')
    on conflict (employee_id, work_date) do update set checked_in_at = excluded.checked_in_at, check_in_latitude = excluded.check_in_latitude, check_in_longitude = excluded.check_in_longitude, status = 'working', updated_at = now()
    returning * into v_record;
  else
    if v_record.id is null or v_record.checked_in_at is null then raise exception 'check_in_required'; end if;
    if v_record.checked_out_at is not null then raise exception 'already_checked_out'; end if;
    update public.attendance_records set checked_out_at = v_now, check_out_latitude = p_latitude, check_out_longitude = p_longitude, worked_minutes = greatest(0, floor(extract(epoch from (v_now - checked_in_at)) / 60)::integer - break_minutes), status = 'completed', updated_at = now() where id = v_record.id returning * into v_record;
  end if;
  return v_record;
end;
$$;
grant execute on function public.record_qr_attendance(text, text, numeric, numeric) to authenticated;
