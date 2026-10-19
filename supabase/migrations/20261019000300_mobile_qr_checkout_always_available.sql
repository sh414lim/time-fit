-- An open attendance record must always be closable. Missing schedules and
-- long shifts are reporting signals, not a reason to block employee checkout.

create or replace function public.timefit_user_mobile_qr_attendance(
  p_token text,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_qr public.timefit_user_mobile_attendance_qr_tokens;
  v_staff public.timefit_user_staff;
  v_record public.timefit_user_attendance_records;
  v_timezone text;
  v_org_name text;
  v_today date;
  v_now timestamptz:=clock_timestamp();
  v_action text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if nullif(trim(p_token),'') is null or p_request_key is null then raise exception using errcode='22023',message='invalid_attendance_request'; end if;

  select token.* into v_qr
  from public.timefit_user_mobile_attendance_qr_tokens token
  where token.token_hash=encode(extensions.digest(trim(p_token),'sha256'),'hex')
  limit 1;
  if v_qr.id is null then raise exception using errcode='22023',message='invalid_or_expired_qr'; end if;

  select * into v_staff
  from public.timefit_user_staff
  where organization_id=v_qr.organization_id and user_id=auth.uid()
  limit 1;
  if v_staff.id is null then raise exception using errcode='42501',message='workplace_access_denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_staff.id::text,0));

  select coalesce(settings.timezone,'Asia/Seoul'),organization.name
  into v_timezone,v_org_name
  from public.timefit_user_organizations organization
  left join public.timefit_user_organization_settings settings
    on settings.organization_id=organization.id
  where organization.id=v_qr.organization_id;
  v_timezone:=coalesce(v_timezone,'Asia/Seoul');
  v_today:=(v_now at time zone v_timezone)::date;

  select * into v_record
  from public.timefit_user_attendance_records
  where staff_id=v_staff.id
    and (check_in_request_key=p_request_key or check_out_request_key=p_request_key)
  order by work_date desc limit 1 for update;
  if v_record.id is not null then
    v_action:=case when v_record.check_out_request_key=p_request_key then 'check_out' else 'check_in' end;
    return jsonb_build_object(
      'action',v_action,'duplicate',true,'workDate',v_record.work_date,
      'timezone',v_timezone,'organizationId',v_qr.organization_id,
      'workplaceName',v_org_name,'checkedInAt',v_record.checked_in_at,
      'checkedOutAt',v_record.checked_out_at,'nextAction',
      case when v_record.checked_out_at is null then 'check_out' else 'completed' end,
      'status',v_record.status,'needsReview',v_record.needs_review,
      'serverTime',v_now,'requestId',p_request_key
    );
  end if;

  if not (v_qr.is_active and v_qr.revoked_at is null and v_qr.expires_at>v_now and exists(
    select 1 from public.timefit_user_attendance_qr_sessions session
    where session.id=v_qr.display_session_id and session.revoked_at is null
  )) then
    raise exception using errcode='22023',message='invalid_or_expired_qr';
  end if;

  select * into v_record
  from public.timefit_user_attendance_records
  where staff_id=v_staff.id and checked_in_at is not null and checked_out_at is null
  order by checked_in_at desc limit 1 for update;

  if v_record.id is not null then
    if v_now-v_record.checked_in_at<interval '60 seconds' then
      return jsonb_build_object(
        'action','check_in','duplicate',true,'workDate',v_record.work_date,
        'timezone',v_timezone,'organizationId',v_qr.organization_id,
        'workplaceName',v_org_name,'checkedInAt',v_record.checked_in_at,
        'checkedOutAt',null,'nextAction','check_out','status',v_record.status,
        'needsReview',false,'serverTime',v_now,'requestId',p_request_key
      );
    end if;
    update public.timefit_user_attendance_records
    set checked_out_at=v_now,check_out_request_key=p_request_key,
        status='completed',needs_review=false,updated_at=v_now
    where id=v_record.id returning * into v_record;
    v_action:='check_out';
  else
    select * into v_record
    from public.timefit_user_attendance_records
    where staff_id=v_staff.id and work_date=v_today
    for update;
    if v_record.id is not null then
      return jsonb_build_object(
        'action','check_out','duplicate',true,'workDate',v_record.work_date,
        'timezone',v_timezone,'organizationId',v_qr.organization_id,
        'workplaceName',v_org_name,'checkedInAt',v_record.checked_in_at,
        'checkedOutAt',v_record.checked_out_at,'nextAction','completed',
        'status',v_record.status,'needsReview',false,'serverTime',v_now,
        'requestId',p_request_key
      );
    end if;
    insert into public.timefit_user_attendance_records(
      organization_id,staff_id,work_date,checked_in_at,source,
      check_in_request_key,status,needs_review
    ) values (
      v_qr.organization_id,v_staff.id,v_today,v_now,'mobile_qr',
      p_request_key,'working',false
    ) returning * into v_record;
    v_action:='check_in';
  end if;

  return jsonb_build_object(
    'action',v_action,'duplicate',false,'workDate',v_record.work_date,
    'timezone',v_timezone,'organizationId',v_qr.organization_id,
    'workplaceName',v_org_name,'checkedInAt',v_record.checked_in_at,
    'checkedOutAt',v_record.checked_out_at,'nextAction',
    case when v_record.checked_out_at is null then 'check_out' else 'completed' end,
    'status',v_record.status,'needsReview',false,'serverTime',v_now,
    'requestId',p_request_key
  );
end;
$$;

create or replace function public.timefit_user_mobile_attendance_today(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_staff public.timefit_user_staff;
  v_record public.timefit_user_attendance_records;
  v_timezone text;
  v_name text;
  v_today date;
  v_now timestamptz:=clock_timestamp();
  v_request_id uuid:=gen_random_uuid();
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select * into v_staff from public.timefit_user_staff
  where user_id=auth.uid() and organization_id=p_organization_id limit 1;
  if v_staff.id is null then raise exception using errcode='42501',message='staff_access_denied'; end if;
  select coalesce(settings.timezone,'Asia/Seoul'),organization.name
  into v_timezone,v_name
  from public.timefit_user_organizations organization
  left join public.timefit_user_organization_settings settings
    on settings.organization_id=organization.id
  where organization.id=p_organization_id;
  v_timezone:=coalesce(v_timezone,'Asia/Seoul');
  v_today:=(v_now at time zone v_timezone)::date;
  select * into v_record from public.timefit_user_attendance_records
  where staff_id=v_staff.id and checked_in_at is not null and checked_out_at is null
  order by checked_in_at desc limit 1;
  if v_record.id is null then
    select * into v_record from public.timefit_user_attendance_records
    where staff_id=v_staff.id and work_date=v_today;
  end if;
  return jsonb_build_object(
    'workDate',coalesce(v_record.work_date,v_today),'timezone',v_timezone,
    'organizationId',p_organization_id,'workplaceName',v_name,
    'checkedInAt',v_record.checked_in_at,'checkedOutAt',v_record.checked_out_at,
    'nextAction',case
      when v_record.id is null then 'check_in'
      when v_record.checked_in_at is not null and v_record.checked_out_at is null then 'check_out'
      else 'completed'
    end,
    'status',coalesce(v_record.status,'working'),
    'needsReview',coalesce(v_record.needs_review,false),
    'serverTime',v_now,'requestId',v_request_id
  );
end;
$$;

revoke all on function public.timefit_user_mobile_qr_attendance(text,uuid),public.timefit_user_mobile_attendance_today(uuid) from public;
grant execute on function public.timefit_user_mobile_qr_attendance(text,uuid),public.timefit_user_mobile_attendance_today(uuid) to authenticated;
select pg_notify('pgrst','reload schema');
