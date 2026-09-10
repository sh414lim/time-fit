-- Keep tablet lookup and write actions on the identical attendance state.
-- Selecting scalar timestamps avoids a stale/composite row state during the
-- lookup branch and makes the next tablet action explicit.
create or replace function public.timefit_user_tablet_attendance_v2(
  p_device_token text,
  p_phone_last4 text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.timefit_user_tablet_devices;
  v_settings public.timefit_user_organization_settings;
  v_staff public.timefit_user_staff;
  v_name text;
  v_record public.timefit_user_attendance_records;
  v_checked_in_at timestamptz;
  v_checked_out_at timestamptz;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_granted_by uuid;
begin
  if p_phone_last4 !~ '^[0-9]{4}$' or p_action not in ('lookup', 'check_in', 'check_out') then
    raise exception 'invalid_payload';
  end if;

  select * into v_device
  from public.timefit_user_tablet_devices
  where token_hash = encode(extensions.digest(p_device_token, 'sha256'), 'hex')
    and status = 'active'
    and expires_at > now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;

  select * into v_settings from public.timefit_user_organization_settings where organization_id = v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;

  select * into v_staff from public.timefit_user_staff where organization_id = v_device.organization_id and phone_last4 = p_phone_last4;
  if v_staff is null then raise exception 'employee_not_found'; end if;
  if v_staff.user_id is not null then select display_name into v_name from public.timefit_user_accounts where id = v_staff.user_id; end if;
  v_name := coalesce(v_name, v_staff.display_name, '직원');

  select checked_in_at, checked_out_at into v_checked_in_at, v_checked_out_at
  from public.timefit_user_attendance_records
  where staff_id = v_staff.id and work_date = v_today
  order by checked_in_at desc nulls last
  limit 1;

  if p_action = 'lookup' then
    update public.timefit_user_tablet_devices set last_used_at = now() where id = v_device.id;
    return jsonb_build_object(
      'employeeName', v_name,
      'nextAction', case when v_checked_in_at is not null and v_checked_out_at is null then 'check_out' else 'check_in' end
    );
  end if;

  select * into v_record from public.timefit_user_attendance_records where staff_id = v_staff.id and work_date = v_today order by checked_in_at desc nulls last limit 1;
  if p_action = 'check_in' then
    if v_checked_in_at is not null then raise exception 'already_checked_in'; end if;
    insert into public.timefit_user_attendance_records(organization_id, staff_id, work_date, checked_in_at, source)
    values(v_device.organization_id, v_staff.id, v_today, now(), 'tablet_device')
    on conflict(staff_id, work_date) do update set checked_in_at = excluded.checked_in_at, source = excluded.source
    returning * into v_record;
  else
    if v_checked_in_at is null then raise exception 'check_in_required'; end if;
    if v_checked_out_at is not null then raise exception 'already_checked_out'; end if;
    update public.timefit_user_attendance_records set checked_out_at = now(), source = 'tablet_device' where id = v_record.id returning * into v_record;
    if v_today = any(v_settings.public_holiday_dates) and v_settings.public_holiday_work_compensation <> 'none' then
      select coalesce(v_staff.user_id, owner_id) into v_granted_by from public.timefit_user_organizations where id = v_device.organization_id;
      insert into public.timefit_user_leave_grants(organization_id, staff_id, amount, reason, granted_by, grant_type, attendance_record_id)
      values(v_device.organization_id, v_staff.id, v_settings.public_holiday_work_compensation_days, '공휴일 근무 보상 ' || v_today::text, v_granted_by,
        case when v_settings.public_holiday_work_compensation = 'substitute_day_off' then 'holiday_substitute_day_off' else 'holiday_paid_leave' end, v_record.id)
      on conflict (attendance_record_id) where attendance_record_id is not null do nothing;
    end if;
  end if;

  update public.timefit_user_tablet_devices set last_used_at = now() where id = v_device.id;
  return jsonb_build_object('employeeName', v_name, 'action', p_action, 'record', to_jsonb(v_record));
end $$;

grant execute on function public.timefit_user_tablet_attendance_v2(text, text, text) to anon, authenticated;
select pg_notify('pgrst', 'reload schema');
