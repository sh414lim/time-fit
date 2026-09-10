-- Resolve duplicate phone-last4 attendance identities by explicit staff
-- selection followed by phone-last8 verification. No retry lockout is used.
create or replace function public.timefit_user_tablet_attendance_v3(
  p_device_token text,
  p_phone_last4 text,
  p_action text,
  p_staff_id uuid default null,
  p_phone_last8 text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_device public.timefit_user_tablet_devices; v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_name text;
  v_record public.timefit_user_attendance_records; v_checked_in_at timestamptz; v_checked_out_at timestamptz; v_candidate_count integer;
  v_today date := (now() at time zone 'Asia/Seoul')::date; v_granted_by uuid; v_compensation text; v_compensation_days numeric(5,2); v_label text;
begin
  if p_phone_last4 !~ '^[0-9]{4}$' or p_action not in ('lookup','check_in','check_out') then raise exception 'invalid_payload'; end if;
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token,'sha256'),'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;

  select count(*) into v_candidate_count from public.timefit_user_staff where organization_id=v_device.organization_id and phone_last4=p_phone_last4;
  if v_candidate_count=0 then raise exception 'employee_not_found'; end if;
  if v_candidate_count>1 and p_staff_id is null then
    if p_action<>'lookup' then raise exception 'employee_selection_required'; end if;
    update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
    return jsonb_build_object(
      'requiresPhoneLast8',true,
      'candidates',(select jsonb_agg(jsonb_build_object('staffId',s.id,'employeeName',coalesce(a.display_name,s.display_name,'직원'),'department',coalesce(s.department,'미분류')) order by coalesce(a.display_name,s.display_name,'직원')) from public.timefit_user_staff s left join public.timefit_user_accounts a on a.id=s.user_id where s.organization_id=v_device.organization_id and s.phone_last4=p_phone_last4)
    );
  end if;

  if p_staff_id is not null then
    if p_phone_last8 !~ '^[0-9]{8}$' then raise exception 'phone_last8_required'; end if;
    select * into v_staff from public.timefit_user_staff where id=p_staff_id and organization_id=v_device.organization_id and phone_last4=p_phone_last4 and phone_last8=p_phone_last8;
    if v_staff is null then raise exception 'phone_last8_mismatch'; end if;
  else
    select * into v_staff from public.timefit_user_staff where organization_id=v_device.organization_id and phone_last4=p_phone_last4 limit 1;
  end if;

  if v_staff.user_id is not null then select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id; end if;
  v_name:=coalesce(v_name,v_staff.display_name,'직원');
  select checked_in_at,checked_out_at into v_checked_in_at,v_checked_out_at from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today limit 1;
  if p_action='lookup' then
    update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
    return jsonb_build_object('staffId',v_staff.id,'employeeName',v_name,'nextAction',case when v_checked_in_at is not null and v_checked_out_at is null then 'check_out' else 'check_in' end,'requiresPhoneLast8',false);
  end if;
  select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today limit 1;
  if p_action='check_in' then
    if v_checked_in_at is not null then raise exception 'already_checked_in'; end if;
    insert into public.timefit_user_attendance_records(organization_id,staff_id,work_date,checked_in_at,source) values(v_device.organization_id,v_staff.id,v_today,now(),'tablet_device') on conflict(staff_id,work_date) do update set checked_in_at=excluded.checked_in_at,source=excluded.source returning * into v_record;
  else
    if v_checked_in_at is null then raise exception 'check_in_required'; end if;
    if v_checked_out_at is not null then raise exception 'already_checked_out'; end if;
    update public.timefit_user_attendance_records set checked_out_at=now(),source='tablet_device' where id=v_record.id returning * into v_record;
    if v_today=any(v_settings.public_holiday_dates) then v_compensation:=v_settings.public_holiday_work_compensation; v_compensation_days:=v_settings.public_holiday_work_compensation_days; v_label:='공휴일 근무 보상';
    elsif extract(dow from v_today)::smallint=any(v_settings.weekly_holiday_weekdays) then v_compensation:=v_settings.weekly_holiday_work_compensation; v_compensation_days:=v_settings.weekly_holiday_work_compensation_days; v_label:='정기휴일 근무 보상';
    else v_compensation:='none'; end if;
    if v_compensation<>'none' then
      select coalesce(v_staff.user_id,owner_id) into v_granted_by from public.timefit_user_organizations where id=v_device.organization_id;
      insert into public.timefit_user_leave_grants(organization_id,staff_id,amount,reason,granted_by,grant_type,attendance_record_id) values(v_device.organization_id,v_staff.id,v_compensation_days,v_label||' '||v_today::text,v_granted_by,case when v_compensation='substitute_day_off' then 'holiday_substitute_day_off' else 'holiday_paid_leave' end,v_record.id) on conflict (attendance_record_id) where attendance_record_id is not null do nothing;
    end if;
  end if;
  update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
  return jsonb_build_object('staffId',v_staff.id,'employeeName',v_name,'action',p_action,'record',to_jsonb(v_record));
end $$;

grant execute on function public.timefit_user_tablet_attendance_v3(text,text,text,uuid,text) to anon, authenticated;
select pg_notify('pgrst','reload schema');
