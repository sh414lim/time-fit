create or replace function public.timefit_user_tablet_leave_request(
  p_organization_id uuid,
  p_pin text,
  p_phone_last8 text,
  p_starts_on date,
  p_ends_on date,
  p_leave_type text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_settings public.timefit_user_organization_settings;
  v_staff public.timefit_user_staff;
  v_manager public.timefit_user_staff;
  v_leave public.timefit_user_leave_requests;
  v_name text;
  v_amount numeric(5,2);
begin
  if p_pin !~ '^[0-9]{4}$' or p_phone_last8 !~ '^[0-9]{8}$' then raise exception 'invalid_payload'; end if;
  if p_starts_on < (now() at time zone 'Asia/Seoul')::date or p_ends_on < p_starts_on then raise exception 'invalid_date'; end if;
  if p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_leave_type'; end if;
  select * into v_settings from public.timefit_user_organization_settings where organization_id=p_organization_id;
  if v_settings is null or not v_settings.tablet_enabled or v_settings.tablet_pin<>p_pin then raise exception 'tablet_access_denied'; end if;
  select * into v_staff from public.timefit_user_staff where organization_id=p_organization_id and phone_last8=p_phone_last8;
  if v_staff is null then raise exception 'employee_not_found'; end if;
  v_amount := case when p_leave_type='연차' then (p_ends_on-p_starts_on+1)::numeric else .5::numeric end;
  insert into public.timefit_user_leave_requests(organization_id,staff_id,starts_on,ends_on,leave_type,amount,source)
  values(p_organization_id,v_staff.id,p_starts_on,p_ends_on,p_leave_type,v_amount,'tablet') returning * into v_leave;
  select * into v_manager from public.timefit_user_staff where organization_id=p_organization_id and job_title='관리자' order by created_at limit 1;
  insert into public.timefit_user_notification_logs(organization_id,leave_request_id,recipient_staff_id,status,error_message)
  values(p_organization_id,v_leave.id,v_manager.id,case when v_manager.phone_last8 is null then 'disabled' else 'queued' end,case when v_manager.phone_last8 is null then 'manager_phone_not_registered' else null end);
  select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id;
  return jsonb_build_object('employeeName',coalesce(v_name,'직원'),'amount',v_amount,'leaveRequestId',v_leave.id);
end $$;

grant execute on function public.timefit_user_tablet_leave_request(uuid,text,text,date,date,text) to anon, authenticated;
