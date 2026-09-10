create or replace function public.timefit_user_tablet_attendance(
  p_organization_id uuid, p_phone_last4 text, p_pin text, p_action text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_name text; v_record public.timefit_user_attendance_records; v_today date := (now() at time zone 'Asia/Seoul')::date; v_action text;
begin
  if p_phone_last4 !~ '^[0-9]{4}$' or p_pin !~ '^[0-9]{4}$' then raise exception 'invalid_payload'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=p_organization_id;
  if v_settings is null or not v_settings.tablet_enabled or v_settings.tablet_pin<>p_pin then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=p_organization_id and phone_last4=p_phone_last4;
  if v_staff is null then raise exception 'employee_not_found'; end if;
  select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id;
  select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today;
  if p_action='lookup' then return jsonb_build_object('employeeName',coalesce(v_name,'직원'),'nextAction',case when v_record.checked_in_at is not null and v_record.checked_out_at is null then 'check_out' else 'check_in' end); end if;
  if p_action not in ('check_in','check_out') then raise exception 'invalid_action'; end if;
  v_action:=p_action;
  if v_action='check_in' then
    if v_record.checked_in_at is not null then raise exception 'already_checked_in'; end if;
    insert into public.timefit_user_attendance_records(organization_id,staff_id,work_date,checked_in_at,source) values(p_organization_id,v_staff.id,v_today,now(),'tablet_phone_last4') on conflict(staff_id,work_date) do update set checked_in_at=excluded.checked_in_at, source=excluded.source returning * into v_record;
  else
    if v_record.checked_in_at is null then raise exception 'check_in_required'; end if;
    if v_record.checked_out_at is not null then raise exception 'already_checked_out'; end if;
    update public.timefit_user_attendance_records set checked_out_at=now(),source='tablet_phone_last4' where id=v_record.id returning * into v_record;
  end if;
  return jsonb_build_object('employeeName',coalesce(v_name,'직원'),'action',v_action,'record',to_jsonb(v_record));
end $$;
grant execute on function public.timefit_user_tablet_attendance(uuid,text,text,text) to anon, authenticated;
