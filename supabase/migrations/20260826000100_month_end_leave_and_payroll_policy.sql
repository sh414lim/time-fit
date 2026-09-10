-- Monthly leave accrual, next-month regular days off, and hourly-pay rounding.
-- The operation is idempotent: the same month can safely be processed again.

alter table public.timefit_user_organization_settings
  add column if not exists attendance_rounding_minutes integer not null default 30
    check (attendance_rounding_minutes in (1, 5, 10, 15, 30, 60)),
  add column if not exists attendance_rounding_mode text not null default 'ceil'
    check (attendance_rounding_mode in ('ceil', 'nearest', 'floor')),
  add column if not exists month_end_auto_processing_enabled boolean not null default true;

alter table public.timefit_user_leave_grants
  add column if not exists accrual_month date;

alter table public.timefit_user_leave_grants
  drop constraint if exists timefit_user_leave_grants_grant_type_check;
alter table public.timefit_user_leave_grants
  add constraint timefit_user_leave_grants_grant_type_check
  check (grant_type in ('manual_leave', 'holiday_paid_leave', 'holiday_substitute_day_off', 'monthly_leave', 'annual_leave'));

create unique index if not exists timefit_user_leave_grants_monthly_accrual_unique
  on public.timefit_user_leave_grants(staff_id, grant_type, accrual_month)
  where accrual_month is not null and grant_type in ('monthly_leave', 'annual_leave');

create or replace function public.timefit_user_run_month_end_operations(
  p_organization_id uuid,
  p_target_month date default date_trunc('month', (now() at time zone 'Asia/Seoul'))::date
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.timefit_user_organization_settings;
  v_staff public.timefit_user_staff;
  v_target_month date := date_trunc('month', p_target_month)::date;
  v_month_end date;
  v_next_month date;
  v_next_month_end date;
  v_work_days integer;
  v_completed_months integer;
  v_first_annual_month date;
  v_annual_month_distance integer;
  v_monthly_grants integer := 0;
  v_annual_grants integer := 0;
  v_next_month_days_off integer := 0;
  v_day date;
  v_day_type text;
begin
  if auth.role() <> 'service_role'
     and not public.timefit_user_has_membership_role(p_organization_id, array['manager']::public.timefit_user_role[]) then
    raise exception 'manager_role_required';
  end if;

  select * into v_settings
  from public.timefit_user_organization_settings
  where organization_id = p_organization_id;
  if v_settings is null then raise exception 'settings_not_found'; end if;

  v_month_end := (v_target_month + interval '1 month - 1 day')::date;
  v_next_month := (v_target_month + interval '1 month')::date;
  v_next_month_end := (v_next_month + interval '1 month - 1 day')::date;

  for v_staff in
    select * from public.timefit_user_staff
    where organization_id = p_organization_id and joined_on <= v_month_end
  loop
    v_completed_months := greatest(0,
      (extract(year from v_month_end)::integer - extract(year from v_staff.joined_on)::integer) * 12
      + extract(month from v_month_end)::integer - extract(month from v_staff.joined_on)::integer
      - case when extract(day from v_month_end) < extract(day from v_staff.joined_on) then 1 else 0 end
    );
    select count(*) into v_work_days
    from public.timefit_user_work_schedules
    where organization_id = p_organization_id and staff_id = v_staff.id
      and work_date >= v_target_month and work_date <= v_month_end
      and is_day_off = false and starts_at is not null;

    -- Monthly leave is granted only after at least one completed month, before
    -- the first annual grant, and when the manager's work-day condition is met.
    if v_settings.monthly_leave_enabled
       and v_completed_months >= 1
       and v_completed_months < v_settings.annual_leave_grant_after_months
       and v_work_days >= v_settings.monthly_leave_min_scheduled_days then
      insert into public.timefit_user_leave_grants
        (organization_id, staff_id, amount, reason, granted_by, grant_type, accrual_month)
      values
        (p_organization_id, v_staff.id, v_settings.monthly_leave_grant_days,
         to_char(v_target_month, 'YYYY년 MM월') || ' 월차 자동 발생', coalesce(auth.uid(), v_staff.user_id),
         'monthly_leave', v_target_month)
      on conflict (staff_id, grant_type, accrual_month)
        where accrual_month is not null and grant_type in ('monthly_leave', 'annual_leave') do nothing;
      if found then v_monthly_grants := v_monthly_grants + 1; end if;
    end if;

    -- Annual leave repeats at the configured anniversary interval (every 12 months).
    v_first_annual_month := date_trunc('month', (v_staff.joined_on + make_interval(months => v_settings.annual_leave_grant_after_months))::date)::date;
    v_annual_month_distance := (extract(year from v_target_month)::integer - extract(year from v_first_annual_month)::integer) * 12
      + extract(month from v_target_month)::integer - extract(month from v_first_annual_month)::integer;
    if v_target_month >= v_first_annual_month and mod(v_annual_month_distance, 12) = 0 then
      insert into public.timefit_user_leave_grants
        (organization_id, staff_id, amount, reason, granted_by, grant_type, accrual_month)
      values
        (p_organization_id, v_staff.id, v_settings.annual_leave_grant_days,
         to_char(v_target_month, 'YYYY년 MM월') || ' 연차 자동 발생', coalesce(auth.uid(), v_staff.user_id),
         'annual_leave', v_target_month)
      on conflict (staff_id, grant_type, accrual_month)
        where accrual_month is not null and grant_type in ('monthly_leave', 'annual_leave') do nothing;
      if found then v_annual_grants := v_annual_grants + 1; end if;
    end if;

    -- At month end, reserve regular weekly holidays and registered public
    -- holidays for the next month. Existing manager-created schedules win.
    for v_day in select d::date from generate_series(v_next_month, v_next_month_end, interval '1 day') as d loop
      v_day_type := case
        when v_day = any(v_settings.public_holiday_dates) then '공휴일'
        when extract(dow from v_day)::smallint = any(v_settings.weekly_holiday_weekdays) then '정기휴일'
        else null end;
      if v_day_type is not null then
        insert into public.timefit_user_work_schedules
          (organization_id, staff_id, work_date, shift_name, is_day_off, created_by)
        values (p_organization_id, v_staff.id, v_day, v_day_type, true, auth.uid())
        on conflict (staff_id, work_date) do nothing;
        if found then v_next_month_days_off := v_next_month_days_off + 1; end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'targetMonth', v_target_month,
    'monthlyLeaveGranted', v_monthly_grants,
    'annualLeaveGranted', v_annual_grants,
    'nextMonthDaysOffCreated', v_next_month_days_off
  );
end;
$$;

grant execute on function public.timefit_user_run_month_end_operations(uuid,date) to authenticated, service_role;
select pg_notify('pgrst', 'reload schema');
