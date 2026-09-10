create or replace function public.timefit_user_tablet_leave_request_v2(p_device_token text, p_phone_last8 text, p_starts_on date, p_ends_on date, p_leave_type text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_device public.timefit_user_tablet_devices; v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_manager public.timefit_user_staff; v_leave public.timefit_user_leave_requests; v_name text; v_amount numeric(5,2); v_notification_status text;
begin
  if p_phone_last8 !~ '^[0-9]{8}$' or p_starts_on < (now() at time zone 'Asia/Seoul')::date or p_ends_on < p_starts_on or p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_payload'; end if;
  select * into v_device from public.timefit_user_tablet_devices where token_hash=encode(extensions.digest(p_device_token, 'sha256'), 'hex') and status='active' and expires_at>now();
  if v_device is null then raise exception 'tablet_device_not_active'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=v_device.organization_id and (phone_last8=p_phone_last8 or right(regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g'), 8)=p_phone_last8);
  if v_staff is null then raise exception 'employee_not_found'; end if;
  v_amount := public.timefit_user_leave_charge_days(v_device.organization_id,p_starts_on,p_ends_on,p_leave_type);
  if v_amount <= 0 then raise exception 'holiday_leave_not_allowed'; end if;
  insert into public.timefit_user_leave_requests(organization_id,staff_id,starts_on,ends_on,leave_type,amount,source) values(v_device.organization_id,v_staff.id,p_starts_on,p_ends_on,p_leave_type,v_amount,'tablet') returning * into v_leave;
  select * into v_manager from public.timefit_user_staff where organization_id=v_device.organization_id and (job_title='관리자' or user_id = (select user_id from public.timefit_user_memberships where organization_id=v_device.organization_id and role='manager' limit 1)) order by created_at limit 1;
  v_notification_status := case when v_manager.id is null or v_manager.phone_last8 is null then 'disabled' else 'queued' end;
  if v_manager.id is not null then
    insert into public.timefit_user_notification_logs(organization_id,leave_request_id,recipient_staff_id,status,error_message) values(v_device.organization_id,v_leave.id,v_manager.id,v_notification_status,case when v_manager.phone_last8 is null then 'manager_phone_not_registered' else null end);
  end if;
  select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id;
  update public.timefit_user_tablet_devices set last_used_at=now() where id=v_device.id;
  return jsonb_build_object('employeeName',coalesce(v_name,v_staff.display_name,'직원'),'amount',v_amount,'leaveRequestId',v_leave.id,'notificationStatus',v_notification_status);
end $$;
grant execute on function public.timefit_user_tablet_leave_request_v2(text,text,date,date,text) to anon, authenticated;
select pg_notify('pgrst', 'reload schema');
