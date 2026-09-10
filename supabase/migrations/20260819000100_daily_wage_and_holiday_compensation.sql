-- Daily-wage payroll and holiday-work compensation policies.
alter table public.timefit_user_staff
  add column if not exists daily_wage numeric(14,2) check (daily_wage is null or daily_wage >= 0);

alter table public.timefit_user_organization_settings
  add column if not exists weekly_holiday_work_compensation text not null default 'none'
    check (weekly_holiday_work_compensation in ('none', 'substitute_day_off', 'additional_paid_leave')),
  add column if not exists weekly_holiday_work_compensation_days numeric(5,2) not null default 1
    check (weekly_holiday_work_compensation_days > 0 and weekly_holiday_work_compensation_days <= 3);

-- Replace the old staff RPCs so daily, hourly, and monthly pay are mutually explicit.
drop function if exists public.timefit_user_create_manual_staff(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,date);
create function public.timefit_user_create_manual_staff(
  p_organization_id uuid, p_name text, p_phone text, p_department text default null,
  p_job_title text default null, p_pay_type public.timefit_user_pay_type default 'hourly',
  p_hourly_wage numeric default null, p_daily_wage numeric default null,
  p_monthly_salary numeric default null, p_joined_on date default current_date
) returns public.timefit_user_staff language plpgsql security definer set search_path=public as $$
declare v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'); v_staff public.timefit_user_staff;
begin
  if not public.timefit_user_has_membership_role(p_organization_id, array['manager']::public.timefit_user_role[]) then raise exception 'manager_role_required'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'name_required'; end if;
  if length(v_digits) not in (10, 11) then raise exception 'invalid_phone'; end if;
  if p_pay_type = 'hourly' and coalesce(p_hourly_wage, 0) <= 0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type = 'daily' and coalesce(p_daily_wage, 0) <= 0 then raise exception 'daily_wage_required'; end if;
  if p_pay_type = 'monthly' and coalesce(p_monthly_salary, 0) <= 0 then raise exception 'monthly_salary_required'; end if;
  insert into public.timefit_user_staff (organization_id,user_id,display_name,department,job_title,pay_type,hourly_wage,daily_wage,monthly_salary,joined_on,phone_e164,phone_last4,phone_last8)
  values (p_organization_id,null,trim(p_name),nullif(trim(p_department),''),coalesce(nullif(trim(p_job_title),''),'직원'),p_pay_type,
    case when p_pay_type='hourly' then p_hourly_wage else null end,
    case when p_pay_type='daily' then p_daily_wage else null end,
    case when p_pay_type='monthly' then p_monthly_salary else null end,
    coalesce(p_joined_on,current_date),'+82'||case when left(v_digits,1)='0' then substr(v_digits,2) else v_digits end,right(v_digits,4),right(v_digits,8))
  returning * into v_staff;
  return v_staff;
end $$;

drop function if exists public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,date);
create function public.timefit_user_update_staff_profile(
  p_staff_id uuid, p_name text, p_phone text, p_department text, p_job_title text,
  p_pay_type public.timefit_user_pay_type, p_hourly_wage numeric, p_daily_wage numeric,
  p_monthly_salary numeric, p_joined_on date
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
  update public.timefit_user_staff set display_name=trim(p_name),phone_e164='+82'||substr(v_digits,2),phone_last4=right(v_digits,4),phone_last8=right(v_digits,8),department=nullif(trim(p_department),''),job_title=trim(p_job_title),pay_type=p_pay_type,hourly_wage=case when p_pay_type='hourly' then p_hourly_wage else null end,daily_wage=case when p_pay_type='daily' then p_daily_wage else null end,monthly_salary=case when p_pay_type='monthly' then p_monthly_salary else null end,joined_on=p_joined_on where id=p_staff_id returning * into v_staff;
  if v_staff.user_id is not null then update public.timefit_user_accounts set display_name=trim(p_name) where id=v_staff.user_id; end if;
  return v_staff;
end $$;

-- Preview validates an employee and the charge amount, but never creates a leave request.
create or replace function public.timefit_user_tablet_leave_preview_v3(
  p_device_token text, p_phone_last8 text, p_starts_on date, p_ends_on date, p_leave_type text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_device public.timefit_user_tablet_devices; v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_name text; v_amount numeric(5,2);
begin
  if p_phone_last8 !~ '^[0-9]{8}$' or p_starts_on < (now() at time zone 'Asia/Seoul')::date or p_ends_on < p_starts_on or p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_payload'; end if;
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token,'sha256'),'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=v_device.organization_id and (phone_last8=p_phone_last8 or right(regexp_replace(coalesce(phone_e164,''),'[^0-9]','','g'),8)=p_phone_last8);
  if v_staff is null then raise exception 'employee_not_found'; end if;
  v_amount:=public.timefit_user_leave_charge_days(v_device.organization_id,p_starts_on,p_ends_on,p_leave_type);
  if coalesce(v_amount,0)<=0 then raise exception 'holiday_leave_not_allowed'; end if;
  select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id;
  return jsonb_build_object('employeeName',coalesce(v_name,v_staff.display_name,'직원'),'amount',v_amount);
end $$;

-- Public holiday takes precedence when a date is also a regular weekly holiday.
create or replace function public.timefit_user_tablet_attendance_v2(p_device_token text,p_phone_last4 text,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_device public.timefit_user_tablet_devices; v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_name text;
  v_record public.timefit_user_attendance_records; v_checked_in_at timestamptz; v_checked_out_at timestamptz;
  v_today date := (now() at time zone 'Asia/Seoul')::date; v_granted_by uuid; v_compensation text; v_compensation_days numeric(5,2); v_label text;
begin
  if p_phone_last4 !~ '^[0-9]{4}$' or p_action not in ('lookup','check_in','check_out') then raise exception 'invalid_payload'; end if;
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token,'sha256'),'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=v_device.organization_id and phone_last4=p_phone_last4;
  if v_staff is null then raise exception 'employee_not_found'; end if;
  if v_staff.user_id is not null then select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id; end if;
  v_name:=coalesce(v_name,v_staff.display_name,'직원');
  select checked_in_at,checked_out_at into v_checked_in_at,v_checked_out_at from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today order by checked_in_at desc nulls last limit 1;
  if p_action='lookup' then update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id; return jsonb_build_object('employeeName',v_name,'nextAction',case when v_checked_in_at is not null and v_checked_out_at is null then 'check_out' else 'check_in' end); end if;
  select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today order by checked_in_at desc nulls last limit 1;
  if p_action='check_in' then
    if v_checked_in_at is not null then raise exception 'already_checked_in'; end if;
    insert into public.timefit_user_attendance_records(organization_id,staff_id,work_date,checked_in_at,source) values(v_device.organization_id,v_staff.id,v_today,now(),'tablet_device') on conflict(staff_id,work_date) do update set checked_in_at=excluded.checked_in_at,source=excluded.source returning * into v_record;
  else
    if v_checked_in_at is null then raise exception 'check_in_required'; end if;
    if v_checked_out_at is not null then raise exception 'already_checked_out'; end if;
    update public.timefit_user_attendance_records set checked_out_at=now(),source='tablet_device' where id=v_record.id returning * into v_record;
    if v_today=any(v_settings.public_holiday_dates) then
      v_compensation:=v_settings.public_holiday_work_compensation; v_compensation_days:=v_settings.public_holiday_work_compensation_days; v_label:='공휴일 근무 보상';
    elsif extract(dow from v_today)::smallint=any(v_settings.weekly_holiday_weekdays) then
      v_compensation:=v_settings.weekly_holiday_work_compensation; v_compensation_days:=v_settings.weekly_holiday_work_compensation_days; v_label:='정기휴일 근무 보상';
    else v_compensation:='none'; end if;
    if v_compensation <> 'none' then
      select coalesce(v_staff.user_id,owner_id) into v_granted_by from public.timefit_user_organizations where id=v_device.organization_id;
      insert into public.timefit_user_leave_grants(organization_id,staff_id,amount,reason,granted_by,grant_type,attendance_record_id) values(v_device.organization_id,v_staff.id,v_compensation_days,v_label||' '||v_today::text,v_granted_by,case when v_compensation='substitute_day_off' then 'holiday_substitute_day_off' else 'holiday_paid_leave' end,v_record.id) on conflict (attendance_record_id) where attendance_record_id is not null do nothing;
    end if;
  end if;
  update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
  return jsonb_build_object('employeeName',v_name,'action',p_action,'record',to_jsonb(v_record));
end $$;

grant execute on function public.timefit_user_create_manual_staff(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,date) to authenticated;
grant execute on function public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,date) to authenticated;
grant execute on function public.timefit_user_tablet_leave_preview_v3(text,text,date,date,text) to anon, authenticated;
grant execute on function public.timefit_user_tablet_attendance_v2(text,text,text) to anon, authenticated;
select pg_notify('pgrst','reload schema');
