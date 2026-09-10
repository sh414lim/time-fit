-- Manager-controlled staff profile updates and auditable manual leave grants.
create table if not exists public.timefit_user_leave_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  amount numeric(5,2) not null check (amount > 0 and amount <= 30),
  reason text,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists timefit_user_leave_grants_staff_idx on public.timefit_user_leave_grants(organization_id, staff_id, granted_at desc);
alter table public.timefit_user_leave_grants enable row level security;
create policy "manager reads leave grants" on public.timefit_user_leave_grants for select using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "manager creates leave grants" on public.timefit_user_leave_grants for insert with check (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
grant select, insert on public.timefit_user_leave_grants to authenticated;

create or replace function public.timefit_user_update_staff_profile(
  p_staff_id uuid, p_name text, p_phone text, p_department text, p_job_title text,
  p_pay_type public.timefit_user_pay_type, p_hourly_wage numeric, p_monthly_salary numeric, p_joined_on date
) returns public.timefit_user_staff
language plpgsql security definer set search_path = public as $$
declare v_staff public.timefit_user_staff; v_digits text;
begin
  select * into v_staff from public.timefit_user_staff where id = p_staff_id;
  if v_staff is null then raise exception 'staff_not_found'; end if;
  if not public.timefit_user_has_membership_role(v_staff.organization_id, array['manager']::public.timefit_user_role[]) then raise exception 'not_authorized'; end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_job_title), '') is null or p_joined_on is null then raise exception 'required_field_missing'; end if;
  v_digits := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if v_digits !~ '^01[0-9][0-9]{7,8}$' then raise exception 'invalid_phone'; end if;
  if p_pay_type = 'hourly' and coalesce(p_hourly_wage, 0) <= 0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type = 'monthly' and coalesce(p_monthly_salary, 0) <= 0 then raise exception 'monthly_salary_required'; end if;
  update public.timefit_user_staff set display_name = trim(p_name), phone_e164 = '+82' || substr(v_digits, 2), phone_last4 = right(v_digits, 4), phone_last8 = right(v_digits, 8), department = nullif(trim(p_department), ''), job_title = trim(p_job_title), pay_type = p_pay_type, hourly_wage = case when p_pay_type = 'hourly' then p_hourly_wage else null end, monthly_salary = case when p_pay_type = 'monthly' then p_monthly_salary else null end, joined_on = p_joined_on where id = p_staff_id returning * into v_staff;
  if v_staff.user_id is not null then update public.timefit_user_accounts set display_name = trim(p_name) where id = v_staff.user_id; end if;
  return v_staff;
end $$;

create or replace function public.timefit_user_grant_leave(p_staff_id uuid, p_amount numeric, p_reason text default null)
returns public.timefit_user_leave_grants
language plpgsql security definer set search_path = public as $$
declare v_staff public.timefit_user_staff; v_grant public.timefit_user_leave_grants;
begin
  select * into v_staff from public.timefit_user_staff where id = p_staff_id;
  if v_staff is null then raise exception 'staff_not_found'; end if;
  if not public.timefit_user_has_membership_role(v_staff.organization_id, array['manager']::public.timefit_user_role[]) then raise exception 'not_authorized'; end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 30 then raise exception 'invalid_leave_amount'; end if;
  insert into public.timefit_user_leave_grants(organization_id, staff_id, amount, reason, granted_by) values (v_staff.organization_id, v_staff.id, p_amount, nullif(trim(p_reason), ''), auth.uid()) returning * into v_grant;
  return v_grant;
end $$;

grant execute on function public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,date) to authenticated;
grant execute on function public.timefit_user_grant_leave(uuid,numeric,text) to authenticated;
select pg_notify('pgrst', 'reload schema');
