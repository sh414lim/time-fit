create or replace function public.timefit_user_tablet_attendance(p_organization_id uuid,p_phone_last4 text,p_pin text,p_action text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_name text; v_record public.timefit_user_attendance_records; v_today date:=(now() at time zone 'Asia/Seoul')::date; v_action text;
begin
 if p_phone_last4 !~ '^[0-9]{4}$' or p_pin !~ '^[0-9]{4}$' then raise exception 'invalid_payload'; end if;
 select * into v_settings from public.timefit_user_organization_settings where organization_id=p_organization_id;
 if v_settings is null or not v_settings.tablet_enabled or v_settings.tablet_pin<>p_pin then raise exception 'tablet_access_denied'; end if;
 select * into v_staff from public.timefit_user_staff where organization_id=p_organization_id and phone_last4=p_phone_last4;
 if v_staff is null then raise exception 'employee_not_found'; end if;
 if v_staff.user_id is not null then select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id; end if;
 v_name:=coalesce(v_name,v_staff.display_name,'직원');
 select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=v_today;
 if p_action='lookup' then return jsonb_build_object('employeeName',v_name,'nextAction',case when v_record.checked_in_at is not null and v_record.checked_out_at is null then 'check_out' else 'check_in' end); end if;
 if p_action not in ('check_in','check_out') then raise exception 'invalid_action'; end if; v_action:=p_action;
 if v_action='check_in' then if v_record.checked_in_at is not null then raise exception 'already_checked_in'; end if; insert into public.timefit_user_attendance_records(organization_id,staff_id,work_date,checked_in_at,source) values(p_organization_id,v_staff.id,v_today,now(),'tablet_phone_last4') on conflict(staff_id,work_date) do update set checked_in_at=excluded.checked_in_at,source=excluded.source returning * into v_record;
 else if v_record.checked_in_at is null then raise exception 'check_in_required'; end if; if v_record.checked_out_at is not null then raise exception 'already_checked_out'; end if; update public.timefit_user_attendance_records set checked_out_at=now(),source='tablet_phone_last4' where id=v_record.id returning * into v_record; end if;
 return jsonb_build_object('employeeName',v_name,'action',v_action,'record',to_jsonb(v_record));
end $$;

create or replace function public.timefit_user_tablet_leave_request(p_organization_id uuid,p_pin text,p_phone_last8 text,p_starts_on date,p_ends_on date,p_leave_type text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_settings public.timefit_user_organization_settings; v_staff public.timefit_user_staff; v_manager public.timefit_user_staff; v_leave public.timefit_user_leave_requests; v_name text; v_amount numeric(5,2); v_notification_status text;
begin
 if p_pin !~ '^[0-9]{4}$' or p_phone_last8 !~ '^[0-9]{8}$' then raise exception 'invalid_payload'; end if; if p_starts_on < (now() at time zone 'Asia/Seoul')::date or p_ends_on<p_starts_on then raise exception 'invalid_date'; end if; if p_leave_type not in ('연차','오전 반차','오후 반차') then raise exception 'invalid_leave_type'; end if;
 select * into v_settings from public.timefit_user_organization_settings where organization_id=p_organization_id; if v_settings is null or not v_settings.tablet_enabled or v_settings.tablet_pin<>p_pin then raise exception 'tablet_access_denied'; end if;
 select * into v_staff from public.timefit_user_staff where organization_id=p_organization_id and phone_last8=p_phone_last8; if v_staff is null then raise exception 'employee_not_found'; end if;
 v_amount:=case when p_leave_type='연차' then (p_ends_on-p_starts_on+1)::numeric else .5::numeric end;
 insert into public.timefit_user_leave_requests(organization_id,staff_id,starts_on,ends_on,leave_type,amount,source) values(p_organization_id,v_staff.id,p_starts_on,p_ends_on,p_leave_type,v_amount,'tablet') returning * into v_leave;
 select * into v_manager from public.timefit_user_staff where organization_id=p_organization_id and job_title='관리자' order by created_at limit 1; v_notification_status:=case when v_manager.phone_last8 is null then 'disabled' else 'queued' end;
 insert into public.timefit_user_notification_logs(organization_id,leave_request_id,recipient_staff_id,status,error_message) values(p_organization_id,v_leave.id,v_manager.id,v_notification_status,case when v_notification_status='disabled' then 'manager_phone_not_registered' else null end);
 if v_staff.user_id is not null then select display_name into v_name from public.timefit_user_accounts where id=v_staff.user_id; end if; v_name:=coalesce(v_name,v_staff.display_name,'직원');
 return jsonb_build_object('employeeName',v_name,'amount',v_amount,'leaveRequestId',v_leave.id,'notificationStatus',v_notification_status);
end $$;
select pg_notify('pgrst','reload schema');
