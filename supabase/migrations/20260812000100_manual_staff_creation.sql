-- Managers can register temporary/offline staff before the staff member has an app account.
alter table public.timefit_user_staff alter column user_id drop not null;
alter table public.timefit_user_staff add column if not exists display_name text;

create or replace function public.timefit_user_create_manual_staff(
  p_organization_id uuid,
  p_name text,
  p_phone text,
  p_department text default null,
  p_job_title text default null,
  p_pay_type public.timefit_user_pay_type default 'hourly',
  p_hourly_wage numeric default null,
  p_monthly_salary numeric default null,
  p_joined_on date default current_date
) returns public.timefit_user_staff language plpgsql security definer set search_path=public as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_staff public.timefit_user_staff;
begin
  if not public.timefit_user_has_membership_role(p_organization_id, array['manager']::public.timefit_user_role[]) then
    raise exception 'manager_role_required';
  end if;
  if nullif(trim(p_name), '') is null then raise exception 'name_required'; end if;
  if length(v_digits) not in (10, 11) then raise exception 'invalid_phone'; end if;
  if p_pay_type = 'hourly' and coalesce(p_hourly_wage, 0) <= 0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type = 'monthly' and coalesce(p_monthly_salary, 0) <= 0 then raise exception 'monthly_salary_required'; end if;
  insert into public.timefit_user_staff (
    organization_id, user_id, display_name, department, job_title, pay_type, hourly_wage, monthly_salary, joined_on,
    phone_e164, phone_last4, phone_last8
  ) values (
    p_organization_id, null, trim(p_name), nullif(trim(p_department), ''), coalesce(nullif(trim(p_job_title), ''), '직원'), p_pay_type,
    case when p_pay_type = 'hourly' then p_hourly_wage else null end,
    case when p_pay_type = 'monthly' then p_monthly_salary else null end,
    coalesce(p_joined_on, current_date), '+82' || case when left(v_digits, 1) = '0' then substr(v_digits, 2) else v_digits end,
    right(v_digits, 4), right(v_digits, 8)
  ) returning * into v_staff;
  return v_staff;
end;
$$;

grant execute on function public.timefit_user_create_manual_staff(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,date) to authenticated;
select pg_notify('pgrst', 'reload schema');
