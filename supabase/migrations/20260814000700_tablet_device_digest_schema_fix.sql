-- Supabase installs pgcrypto in the extensions schema. The tablet RPCs use a
-- restricted search_path, so qualify digest explicitly for token validation.
create or replace function public.timefit_user_activate_tablet_device(p_organization_id uuid, p_display_name text, p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_token text; v_device public.timefit_user_tablet_devices;
begin
  if not public.timefit_user_has_membership_role(p_organization_id, array['manager']::public.timefit_user_role[]) then raise exception 'tablet_manager_required'; end if;
  if nullif(trim(p_display_name), '') is null then raise exception 'tablet_name_required'; end if;
  update public.timefit_user_tablet_devices set status='revoked', revoked_at=now(), revoked_by=auth.uid() where organization_id=p_organization_id and display_name=trim(p_display_name) and status='active';
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.timefit_user_tablet_devices(organization_id, display_name, token_hash, activated_by, metadata)
  values(p_organization_id, trim(p_display_name), encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), coalesce(p_metadata, '{}'::jsonb)) returning * into v_device;
  return jsonb_build_object('deviceToken', v_token, 'deviceId', v_device.id, 'organizationId', v_device.organization_id, 'displayName', v_device.display_name, 'expiresAt', v_device.expires_at);
end $$;

create or replace function public.timefit_user_tablet_device_context(p_device_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_device public.timefit_user_tablet_devices; v_org public.timefit_user_organizations; v_settings public.timefit_user_organization_settings;
begin
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token, 'sha256'), 'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;
  select * into v_org from public.timefit_user_organizations where id=v_device.organization_id;
  return jsonb_build_object('organizationId',v_device.organization_id,'organizationName',coalesce(v_settings.workplace_name,v_org.name),'deviceName',v_device.display_name,'expiresAt',v_device.expires_at);
end $$;

create or replace function public.timefit_user_tablet_attendance_v2(p_device_token text, p_phone_last4 text, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_device public.timefit_user_tablet_devices; v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_name text; v_record public.timefit_user_attendance_records; v_today date:=(now() at time zone 'Asia/Seoul')::date; v_granted_by uuid;
begin
  if p_phone_last4 !~ '^[0-9]{4}$' or p_action not in ('lookup','check_in','check_out') then raise exception 'invalid_payload'; end if;
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token, 'sha256'), 'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=v_device.organization_id and phone_last4=p_phone_last4;
  if v_staff is null then raise exception 'employee_not_found'; end if;
  if v_staff.user_id is not null then select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id; end if;
  v_name:=coalesce(v_name,v_staff.display_name,'직원');
  select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today;
  if p_action='lookup' then update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id; return jsonb_build_object('employeeName',v_name,'nextAction',case when v_record.checked_in_at is not null and v_record.checked_out_at is null then 'check_out' else 'check_in' end); end if;
  if p_action='check_in' then
    if v_record.checked_in_at is not null then raise exception 'already_checked_in'; end if;
    insert into public.timefit_user_attendance_records(organization_id,staff_id,work_date,checked_in_at,source) values(v_device.organization_id,v_staff.id,v_today,now(),'tablet_device') on conflict(staff_id,work_date) do update set checked_in_at=excluded.checked_in_at,source=excluded.source returning * into v_record;
  else
    if v_record.checked_in_at is null then raise exception 'check_in_required'; end if;
    if v_record.checked_out_at is not null then raise exception 'already_checked_out'; end if;
    update public.timefit_user_attendance_records set checked_out_at=now(),source='tablet_device' where id=v_record.id returning * into v_record;
    if v_today = any(v_settings.public_holiday_dates) and v_settings.public_holiday_work_compensation <> 'none' then
      select coalesce(v_staff.user_id, owner_id) into v_granted_by from public.timefit_user_organizations where id=v_device.organization_id;
      insert into public.timefit_user_leave_grants(organization_id,staff_id,amount,reason,granted_by,grant_type,attendance_record_id) values(v_device.organization_id,v_staff.id,v_settings.public_holiday_work_compensation_days,'공휴일 근무 보상 '||v_today::text,v_granted_by,case when v_settings.public_holiday_work_compensation='substitute_day_off' then 'holiday_substitute_day_off' else 'holiday_paid_leave' end,v_record.id) on conflict (attendance_record_id) where attendance_record_id is not null do nothing;
    end if;
  end if;
  update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
  return jsonb_build_object('employeeName',v_name,'action',p_action,'record',to_jsonb(v_record));
end $$;

create or replace function public.timefit_user_tablet_leave_request_v2(p_device_token text, p_phone_last8 text, p_starts_on date, p_ends_on date, p_leave_type text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_device public.timefit_user_tablet_devices; v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_manager public.timefit_user_staff; v_leave public.timefit_user_leave_requests; v_name text; v_amount numeric(5,2); v_notification_status text;
begin
  if p_phone_last8 !~ '^[0-9]{8}$' or p_starts_on < (now() at time zone 'Asia/Seoul')::date or p_ends_on < p_starts_on or p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_payload'; end if;
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token, 'sha256'), 'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=v_device.organization_id and phone_last8=p_phone_last8;
  if v_staff is null then raise exception 'employee_not_found'; end if;
  v_amount := public.timefit_user_leave_charge_days(v_device.organization_id,p_starts_on,p_ends_on,p_leave_type);
  if v_amount <= 0 then raise exception 'holiday_leave_not_allowed'; end if;
  insert into public.timefit_user_leave_requests(organization_id,staff_id,starts_on,ends_on,leave_type,amount,source) values(v_device.organization_id,v_staff.id,p_starts_on,p_ends_on,p_leave_type,v_amount,'tablet') returning * into v_leave;
  select * into v_manager from public.timefit_user_staff where organization_id=v_device.organization_id and job_title='관리자' order by created_at limit 1;
  v_notification_status := case when v_manager.phone_last8 is null then 'disabled' else 'queued' end;
  insert into public.timefit_user_notification_logs(organization_id,leave_request_id,recipient_staff_id,status,error_message) values(v_device.organization_id,v_leave.id,v_manager.id,v_notification_status,case when v_notification_status='disabled' then 'manager_phone_not_registered' else null end);
  select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id;
  update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
  return jsonb_build_object('employeeName',coalesce(v_name,v_staff.display_name,'직원'),'amount',v_amount,'leaveRequestId',v_leave.id,'notificationStatus',v_notification_status);
end $$;

select pg_notify('pgrst', 'reload schema');
