-- Configurable leave accrual and holiday calculation policy per organization.
alter table public.timefit_user_organization_settings
  add column if not exists annual_leave_grant_days numeric(5,2) not null default 15 check (annual_leave_grant_days >= 0 and annual_leave_grant_days <= 30),
  add column if not exists annual_leave_grant_after_months integer not null default 12 check (annual_leave_grant_after_months between 1 and 60),
  add column if not exists monthly_leave_enabled boolean not null default true,
  add column if not exists monthly_leave_grant_days numeric(5,2) not null default 1 check (monthly_leave_grant_days >= 0 and monthly_leave_grant_days <= 3),
  add column if not exists monthly_leave_min_scheduled_days integer not null default 1 check (monthly_leave_min_scheduled_days between 0 and 31),
  add column if not exists weekly_holiday_weekdays smallint[] not null default array[0]::smallint[] check (weekly_holiday_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  add column if not exists public_holiday_dates date[] not null default array[]::date[],
  add column if not exists exclude_holidays_from_leave boolean not null default true;

create or replace function public.timefit_user_leave_charge_days(
  p_organization_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_leave_type text
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.timefit_user_organization_settings;
  v_days numeric(5,2);
begin
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'invalid_date';
  end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id = p_organization_id;
  if v_settings is null then raise exception 'settings_not_found'; end if;

  if p_leave_type in ('오전 반차', '오후 반차') then
    if p_starts_on <> p_ends_on then raise exception 'half_day_single_date_required'; end if;
    if v_settings.exclude_holidays_from_leave
       and (extract(dow from p_starts_on)::smallint = any(v_settings.weekly_holiday_weekdays)
            or p_starts_on = any(v_settings.public_holiday_dates)) then
      raise exception 'non_working_day';
    end if;
    return 0.5;
  end if;

  select count(*)::numeric into v_days
  from generate_series(p_starts_on, p_ends_on, interval '1 day') as d(work_date)
  where not v_settings.exclude_holidays_from_leave
     or (extract(dow from d.work_date)::smallint <> all(v_settings.weekly_holiday_weekdays)
         and d.work_date::date <> all(v_settings.public_holiday_dates));
  if coalesce(v_days, 0) <= 0 then raise exception 'non_working_day'; end if;
  return v_days;
end;
$$;

create or replace function public.timefit_user_submit_leave_request(
  p_organization_id uuid,
  p_staff_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_leave_type text,
  p_reason text default null
) returns public.timefit_user_leave_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leave public.timefit_user_leave_requests;
  v_amount numeric(5,2);
begin
  if p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_leave_type'; end if;
  if p_staff_id <> public.timefit_user_current_staff_id(p_organization_id) then raise exception 'not_authorized'; end if;
  v_amount := public.timefit_user_leave_charge_days(p_organization_id, p_starts_on, p_ends_on, p_leave_type);
  insert into public.timefit_user_leave_requests(organization_id, staff_id, starts_on, ends_on, leave_type, amount, reason)
  values (p_organization_id, p_staff_id, p_starts_on, p_ends_on, p_leave_type, v_amount, nullif(trim(p_reason), ''))
  returning * into v_leave;
  return v_leave;
end;
$$;

-- Tablet is anonymous, so use the same calculation helper after its own PIN/phone validation.
create or replace function public.timefit_user_tablet_leave_request(
  p_organization_id uuid, p_pin text, p_phone_last8 text, p_starts_on date, p_ends_on date, p_leave_type text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_manager public.timefit_user_staff; v_leave public.timefit_user_leave_requests; v_name text; v_amount numeric(5,2); v_notification_status text;
begin
 if p_pin !~ '^[0-9]{4}$' or p_phone_last8 !~ '^[0-9]{8}$' then raise exception 'invalid_payload'; end if;
 if p_starts_on < (now() at time zone 'Asia/Seoul')::date or p_ends_on<p_starts_on then raise exception 'invalid_date'; end if;
 if p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_leave_type'; end if;
 select * into v_settings from public.timefit_user_organization_settings where organization_id=p_organization_id;
 if v_settings is null or not v_settings.tablet_enabled or v_settings.tablet_pin<>p_pin then raise exception 'tablet_access_denied'; end if;
 select * into v_staff from public.timefit_user_staff where organization_id=p_organization_id and phone_last8=p_phone_last8;
 if v_staff is null then raise exception 'employee_not_found'; end if;
 v_amount := public.timefit_user_leave_charge_days(p_organization_id, p_starts_on, p_ends_on, p_leave_type);
 insert into public.timefit_user_leave_requests(organization_id,staff_id,starts_on,ends_on,leave_type,amount,source) values(p_organization_id,v_staff.id,p_starts_on,p_ends_on,p_leave_type,v_amount,'tablet') returning * into v_leave;
 select coalesce(a.display_name,s.display_name,'직원') into v_name from public.timefit_user_staff s left join public.timefit_user_accounts a on a.id=s.user_id where s.id=v_staff.id;
 select * into v_manager from public.timefit_user_staff where organization_id=p_organization_id and job_title='관리자' order by created_at limit 1;
 v_notification_status:=case when v_manager.id is null or v_manager.phone_last8 is null then 'disabled' else 'queued' end;
 if v_manager.id is not null then insert into public.timefit_user_notification_logs(organization_id,leave_request_id,recipient_staff_id,status,error_message) values(p_organization_id,v_leave.id,v_manager.id,v_notification_status,case when v_notification_status='disabled' then 'manager_phone_not_registered' else null end); end if;
 return jsonb_build_object('employeeName',v_name,'amount',v_amount,'leaveRequestId',v_leave.id,'notificationStatus',v_notification_status);
end $$;

grant execute on function public.timefit_user_leave_charge_days(uuid,date,date,text) to anon, authenticated;
grant execute on function public.timefit_user_submit_leave_request(uuid,uuid,date,date,text,text) to authenticated;
grant execute on function public.timefit_user_tablet_leave_request(uuid,text,text,date,date,text) to anon, authenticated;
select pg_notify('pgrst', 'reload schema');
