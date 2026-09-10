-- Salary type expansion, encrypted staff payment identity data, and payroll-day notifications.
alter table public.timefit_user_staff
  add column if not exists annual_salary numeric(14,2)
    check (annual_salary is null or annual_salary >= 0);

alter table public.timefit_user_payroll_contracts
  add column if not exists annual_salary numeric(14,2)
    check (annual_salary is null or annual_salary >= 0);

do $$ declare item record; begin
  for item in select conname from pg_constraint where conrelid = 'public.timefit_user_payroll_contracts'::regclass and contype = 'c' loop
    execute format('alter table public.timefit_user_payroll_contracts drop constraint %I', item.conname);
  end loop;
end $$;
alter table public.timefit_user_payroll_contracts
  add constraint timefit_user_payroll_contracts_rate_check check (
    (pay_type = 'hourly' and coalesce(hourly_wage, 0) > 0) or
    (pay_type = 'daily' and coalesce(daily_wage, 0) > 0) or
    (pay_type = 'monthly' and coalesce(monthly_salary, 0) > 0) or
    (pay_type = 'annual' and coalesce(annual_salary, 0) > 0)
  );

-- Sensitive values are kept outside the normal staff table. The browser receives
-- only masked summaries through a server endpoint; plaintext is AES-encrypted.
create table if not exists public.timefit_user_staff_sensitive_profiles (
  staff_id uuid primary key references public.timefit_user_staff(id) on delete cascade,
  bank_name text,
  bank_account_last4 text,
  encrypted_bank_account text,
  resident_registration_mask text,
  encrypted_resident_registration_number text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.timefit_user_staff_sensitive_profiles enable row level security;
revoke all on public.timefit_user_staff_sensitive_profiles from anon, authenticated;
grant all on public.timefit_user_staff_sensitive_profiles to service_role;
drop trigger if exists timefit_staff_sensitive_profiles_updated_at on public.timefit_user_staff_sensitive_profiles;
create trigger timefit_staff_sensitive_profiles_updated_at before update on public.timefit_user_staff_sensitive_profiles
for each row execute procedure public.set_updated_at();

alter table public.timefit_user_organization_settings
  add column if not exists payroll_notification_day smallint not null default 25
    check (payroll_notification_day between 1 and 31),
  add column if not exists payroll_notification_email_enabled boolean not null default true,
  add column if not exists payroll_notification_kakao_enabled boolean not null default false,
  add column if not exists payroll_notification_push_enabled boolean not null default false;

create table if not exists public.timefit_user_payroll_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  payroll_month date not null,
  channel text not null check (channel in ('email', 'kakao', 'push')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'pending_configuration', 'skipped')),
  recipient_hint text,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(organization_id, staff_id, payroll_month, channel)
);
create index if not exists timefit_payroll_notification_due_idx on public.timefit_user_payroll_notification_deliveries(organization_id, payroll_month, status);
alter table public.timefit_user_payroll_notification_deliveries enable row level security;
create policy "manager reads payroll notification delivery logs" on public.timefit_user_payroll_notification_deliveries
  for select using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
grant select on public.timefit_user_payroll_notification_deliveries to authenticated;

-- Current manager organization is resolved from auth.uid(), just like the active
-- direct-registration RPC. Keep only one current signature exposed to PostgREST.
drop function if exists public.timefit_user_create_manual_staff(text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,date);
create function public.timefit_user_create_manual_staff(
  p_name text, p_phone text, p_department text default null, p_job_title text default null,
  p_pay_type public.timefit_user_pay_type default 'hourly', p_hourly_wage numeric default null,
  p_daily_wage numeric default null, p_monthly_salary numeric default null,
  p_annual_salary numeric default null, p_joined_on date default current_date
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_digits text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); v_id uuid;
begin
  select organization_id into v_org from public.timefit_user_memberships where user_id=auth.uid() and role='manager' limit 1;
  if v_org is null then raise exception 'manager_role_required'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'name_required'; end if;
  if length(v_digits) not in (10,11) then raise exception 'invalid_phone'; end if;
  if p_pay_type='hourly' and coalesce(p_hourly_wage,0)<=0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type='daily' and coalesce(p_daily_wage,0)<=0 then raise exception 'daily_wage_required'; end if;
  if p_pay_type='monthly' and coalesce(p_monthly_salary,0)<=0 then raise exception 'monthly_salary_required'; end if;
  if p_pay_type='annual' and coalesce(p_annual_salary,0)<=0 then raise exception 'annual_salary_required'; end if;
  insert into public.timefit_user_staff(organization_id,user_id,display_name,department,job_title,pay_type,hourly_wage,daily_wage,monthly_salary,annual_salary,joined_on,phone_e164,phone_last4,phone_last8,registration_type)
  values(v_org,null,trim(p_name),nullif(trim(p_department),''),coalesce(nullif(trim(p_job_title),''),'직원'),p_pay_type,
    case when p_pay_type='hourly' then p_hourly_wage else null end,
    case when p_pay_type='daily' then p_daily_wage else null end,
    case when p_pay_type='monthly' then p_monthly_salary else null end,
    case when p_pay_type='annual' then p_annual_salary else null end,
    coalesce(p_joined_on,current_date),'+82'||case when left(v_digits,1)='0' then substr(v_digits,2) else v_digits end,right(v_digits,4),right(v_digits,8),'manual') returning id into v_id;
  return v_id;
end $$;

drop function if exists public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,date);
create function public.timefit_user_update_staff_profile(
  p_staff_id uuid, p_name text, p_phone text, p_department text, p_job_title text,
  p_pay_type public.timefit_user_pay_type, p_hourly_wage numeric, p_daily_wage numeric,
  p_monthly_salary numeric, p_annual_salary numeric, p_joined_on date
) returns public.timefit_user_staff language plpgsql security definer set search_path=public as $$
declare v_staff public.timefit_user_staff; v_digits text;
begin
  select * into v_staff from public.timefit_user_staff where id=p_staff_id;
  if v_staff is null then raise exception 'staff_not_found'; end if;
  if not public.timefit_user_has_membership_role(v_staff.organization_id,array['manager']::public.timefit_user_role[]) then raise exception 'not_authorized'; end if;
  if nullif(trim(p_name),'') is null or nullif(trim(p_job_title),'') is null or p_joined_on is null then raise exception 'required_field_missing'; end if;
  v_digits := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if v_digits !~ '^01[0-9][0-9]{7,8}$' then raise exception 'invalid_phone'; end if;
  if p_pay_type='hourly' and coalesce(p_hourly_wage,0)<=0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type='daily' and coalesce(p_daily_wage,0)<=0 then raise exception 'daily_wage_required'; end if;
  if p_pay_type='monthly' and coalesce(p_monthly_salary,0)<=0 then raise exception 'monthly_salary_required'; end if;
  if p_pay_type='annual' and coalesce(p_annual_salary,0)<=0 then raise exception 'annual_salary_required'; end if;
  update public.timefit_user_staff set display_name=trim(p_name),phone_e164='+82'||substr(v_digits,2),phone_last4=right(v_digits,4),phone_last8=right(v_digits,8),department=nullif(trim(p_department),''),job_title=trim(p_job_title),pay_type=p_pay_type,hourly_wage=case when p_pay_type='hourly' then p_hourly_wage else null end,daily_wage=case when p_pay_type='daily' then p_daily_wage else null end,monthly_salary=case when p_pay_type='monthly' then p_monthly_salary else null end,annual_salary=case when p_pay_type='annual' then p_annual_salary else null end,joined_on=p_joined_on where id=p_staff_id returning * into v_staff;
  if v_staff.user_id is not null then update public.timefit_user_accounts set display_name=trim(p_name) where id=v_staff.user_id; end if;
  return v_staff;
end $$;

grant execute on function public.timefit_user_create_manual_staff(text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date) to authenticated;
grant execute on function public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date) to authenticated;
select pg_notify('pgrst','reload schema');
