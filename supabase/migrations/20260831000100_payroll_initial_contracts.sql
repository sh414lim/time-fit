-- Each manually registered employee must have a first payroll contract so
-- payroll snapshots always have an explicit contractual basis.
insert into public.timefit_user_payroll_contracts (
  organization_id, staff_id, pay_type, hourly_wage, daily_wage,
  monthly_salary, annual_salary, effective_from, memo
)
select
  s.organization_id,
  s.id,
  s.pay_type,
  case when s.pay_type = 'hourly' then s.hourly_wage else null end,
  case when s.pay_type = 'daily' then s.daily_wage else null end,
  case when s.pay_type = 'monthly' then s.monthly_salary else null end,
  case when s.pay_type = 'annual' then s.annual_salary else null end,
  coalesce(s.joined_on, current_date),
  '직원 등록 정보에서 생성된 초기 계약'
from public.timefit_user_staff s
where (
  (s.pay_type = 'hourly' and coalesce(s.hourly_wage, 0) > 0)
  or (s.pay_type = 'daily' and coalesce(s.daily_wage, 0) > 0)
  or (s.pay_type = 'monthly' and coalesce(s.monthly_salary, 0) > 0)
  or (s.pay_type = 'annual' and coalesce(s.annual_salary, 0) > 0)
)
and not exists (
  select 1 from public.timefit_user_payroll_contracts c where c.staff_id = s.id
);

-- Replace the category-aware direct-registration RPC and create the initial
-- contractual record atomically with the employee record.
drop function if exists public.timefit_user_create_manual_staff(text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date,uuid);
create function public.timefit_user_create_manual_staff(
  p_name text, p_phone text, p_department text default null, p_job_title text default null,
  p_pay_type public.timefit_user_pay_type default 'hourly', p_hourly_wage numeric default null,
  p_daily_wage numeric default null, p_monthly_salary numeric default null,
  p_annual_salary numeric default null, p_joined_on date default current_date,
  p_category_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_org uuid;
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id uuid;
  v_category_name text;
  v_effective_from date := coalesce(p_joined_on, current_date);
begin
  select organization_id into v_org
  from public.timefit_user_memberships
  where user_id = auth.uid() and role = 'manager'
  limit 1;
  if v_org is null then raise exception 'manager_role_required'; end if;
  if p_category_id is not null then
    select name into v_category_name
    from public.timefit_user_staff_categories
    where id = p_category_id and organization_id = v_org;
    if v_category_name is null then raise exception 'invalid_staff_category'; end if;
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'name_required'; end if;
  if length(v_digits) not in (10, 11) then raise exception 'invalid_phone'; end if;
  if p_pay_type = 'hourly' and coalesce(p_hourly_wage, 0) <= 0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type = 'daily' and coalesce(p_daily_wage, 0) <= 0 then raise exception 'daily_wage_required'; end if;
  if p_pay_type = 'monthly' and coalesce(p_monthly_salary, 0) <= 0 then raise exception 'monthly_salary_required'; end if;
  if p_pay_type = 'annual' and coalesce(p_annual_salary, 0) <= 0 then raise exception 'annual_salary_required'; end if;

  insert into public.timefit_user_staff(
    organization_id, user_id, display_name, department, category_id, job_title,
    pay_type, hourly_wage, daily_wage, monthly_salary, annual_salary, joined_on,
    phone_e164, phone_last4, phone_last8, registration_type
  ) values (
    v_org, null, trim(p_name), coalesce(v_category_name, nullif(trim(p_department), '')),
    p_category_id, coalesce(nullif(trim(p_job_title), ''), '직원'), p_pay_type,
    case when p_pay_type = 'hourly' then p_hourly_wage else null end,
    case when p_pay_type = 'daily' then p_daily_wage else null end,
    case when p_pay_type = 'monthly' then p_monthly_salary else null end,
    case when p_pay_type = 'annual' then p_annual_salary else null end,
    v_effective_from,
    '+82' || case when left(v_digits, 1) = '0' then substr(v_digits, 2) else v_digits end,
    right(v_digits, 4), right(v_digits, 8), 'manual'
  ) returning id into v_id;

  insert into public.timefit_user_payroll_contracts(
    organization_id, staff_id, pay_type, hourly_wage, daily_wage,
    monthly_salary, annual_salary, effective_from, memo, created_by
  ) values (
    v_org, v_id, p_pay_type,
    case when p_pay_type = 'hourly' then p_hourly_wage else null end,
    case when p_pay_type = 'daily' then p_daily_wage else null end,
    case when p_pay_type = 'monthly' then p_monthly_salary else null end,
    case when p_pay_type = 'annual' then p_annual_salary else null end,
    v_effective_from, '직접 등록 시 자동 생성된 초기 계약', auth.uid()
  );
  return v_id;
end $$;

grant execute on function public.timefit_user_create_manual_staff(text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date,uuid) to authenticated;
select pg_notify('pgrst', 'reload schema');
