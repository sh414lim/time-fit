-- MGR-05: unify leave, schedule and attendance-correction approvals.

create table if not exists public.timefit_user_attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  attendance_record_id uuid references public.timefit_user_attendance_records(id) on delete set null,
  work_date date not null,
  requested_checked_in_at timestamptz not null,
  requested_checked_out_at timestamptz,
  expected_attendance_updated_at timestamptz,
  reason text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  review_comment text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  request_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id,request_key)
);
create unique index if not exists timefit_attendance_correction_one_pending
  on public.timefit_user_attendance_correction_requests(staff_id,work_date) where status='pending';
create index if not exists timefit_attendance_correction_inbox
  on public.timefit_user_attendance_correction_requests(organization_id,status,created_at desc);
drop trigger if exists timefit_user_attendance_correction_request_updated_at on public.timefit_user_attendance_correction_requests;
create trigger timefit_user_attendance_correction_request_updated_at before update on public.timefit_user_attendance_correction_requests
  for each row execute procedure public.set_updated_at();

alter table public.timefit_user_attendance_correction_requests enable row level security;
drop policy if exists "staff reads own attendance correction requests" on public.timefit_user_attendance_correction_requests;
create policy "staff reads own attendance correction requests" on public.timefit_user_attendance_correction_requests
  for select using(staff_id=public.timefit_user_current_staff_id(organization_id));
grant select on public.timefit_user_attendance_correction_requests to authenticated;
grant all on public.timefit_user_attendance_correction_requests to service_role;

alter table public.timefit_user_mobile_approval_actions
  drop constraint if exists timefit_user_mobile_approval_actions_item_kind_check;
alter table public.timefit_user_mobile_approval_actions
  add constraint timefit_user_mobile_approval_actions_item_kind_check check(item_kind in ('leave','schedule','attendance'));

create or replace function public.timefit_user_mobile_request_attendance_correction(
  p_organization_id uuid,p_work_date date,p_checked_in_at timestamptz,p_checked_out_at timestamptz,p_reason text,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_staff public.timefit_user_staff;v_record public.timefit_user_attendance_records;v_request public.timefit_user_attendance_correction_requests;v_timezone text;v_today date;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  select * into v_staff from public.timefit_user_staff where organization_id=p_organization_id and user_id=auth.uid() limit 1;
  if v_staff.id is null then raise exception using errcode='42501',message='staff_access_denied';end if;
  if p_request_key is null then raise exception using errcode='22023',message='invalid_attendance_correction_request';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_staff.id::text||':'||p_request_key::text,5));
  select * into v_request from public.timefit_user_attendance_correction_requests where staff_id=v_staff.id and request_key=p_request_key;
  if v_request.id is not null then return jsonb_build_object('request',to_jsonb(v_request),'duplicate',true);end if;
  select coalesce(timezone,'Asia/Seoul') into v_timezone from public.timefit_user_organization_settings where organization_id=p_organization_id;
  v_timezone:=coalesce(v_timezone,'Asia/Seoul');v_today:=(now() at time zone v_timezone)::date;
  if p_work_date is null or p_work_date>v_today or p_work_date<v_today-90
    or p_checked_in_at is null or (p_checked_in_at at time zone v_timezone)::date<>p_work_date or p_checked_in_at>now()
    or p_checked_out_at>now() or (p_checked_out_at is not null and (p_checked_out_at<=p_checked_in_at or p_checked_out_at-p_checked_in_at>interval '48 hours'))
    or length(trim(coalesce(p_reason,'')))<2 or length(p_reason)>500 then
    raise exception using errcode='22023',message='invalid_attendance_correction_request';
  end if;
  select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff.id and work_date=p_work_date;
  begin
    insert into public.timefit_user_attendance_correction_requests(
      organization_id,staff_id,attendance_record_id,work_date,requested_checked_in_at,requested_checked_out_at,
      expected_attendance_updated_at,reason,request_key
    ) values(
      p_organization_id,v_staff.id,v_record.id,p_work_date,p_checked_in_at,p_checked_out_at,
      v_record.updated_at,trim(p_reason),p_request_key
    ) returning * into v_request;
  exception when unique_violation then
    raise exception using errcode='40001',message='attendance_correction_pending';
  end;
  return jsonb_build_object('request',to_jsonb(v_request),'duplicate',false);
end $$;

create or replace function public.timefit_user_mobile_attendance_correction_requests(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_staff_id uuid;v_items jsonb;
begin
  select id into v_staff_id from public.timefit_user_staff where organization_id=p_organization_id and user_id=auth.uid() limit 1;
  if v_staff_id is null then raise exception using errcode='42501',message='staff_access_denied';end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb) into v_items from (
    select id,work_date,requested_checked_in_at,requested_checked_out_at,reason,status,review_comment,reviewed_at,created_at
    from public.timefit_user_attendance_correction_requests where staff_id=v_staff_id order by created_at desc limit 20
  ) item;
  return jsonb_build_object('items',v_items,'serverTime',now());
end $$;

create or replace function public.timefit_user_mobile_approval_inbox(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_timezone text;v_items jsonb;v_pending int;v_approved int;v_rejected int;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  if not public.timefit_user_is_organization_owner(p_organization_id)
    and not public.timefit_user_has_management_permission(p_organization_id,'leave.review')
    and not public.timefit_user_has_management_permission(p_organization_id,'schedule.approve')
    and not public.timefit_user_has_management_permission(p_organization_id,'attendance.review_correction') then
    raise exception using errcode='42501',message='approval_access_denied';
  end if;
  select coalesce(settings.timezone,'Asia/Seoul') into v_timezone from public.timefit_user_organizations organization
  left join public.timefit_user_organization_settings settings on settings.organization_id=organization.id where organization.id=p_organization_id;
  if v_timezone is null then raise exception using errcode='42501',message='approval_access_denied';end if;

  with accessible as (
    select request.id,'leave'::text kind,request.status::text status,request.staff_id,coalesce(account.display_name,staff.display_name,'직원') staff_name,category.name category_name,
      request.starts_on,request.ends_on,request.leave_type title,
      concat(request.amount,'일 · ',case request.day_part when 'am' then '오전 반차' when 'pm' then '오후 반차' else '종일' end) detail,
      request.reason,request.review_comment,request.created_at submitted_at,request.reviewed_at,
      jsonb_build_object(
        'leave_balance',jsonb_build_object(
          'granted',coalesce((select sum(grant_item.amount) from public.timefit_user_leave_grants grant_item where grant_item.staff_id=request.staff_id),0),
          'used',coalesce((select sum(used.amount) from public.timefit_user_leave_requests used where used.staff_id=request.staff_id and used.status='approved'),0),
          'pending',coalesce((select sum(pending.amount) from public.timefit_user_leave_requests pending where pending.staff_id=request.staff_id and pending.status='pending'),0)),
        'schedule',case when public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'schedule.view') or public.timefit_user_has_management_permission(p_organization_id,'schedule.manage') or public.timefit_user_has_management_permission(p_organization_id,'schedule.approve') then
          (select coalesce(jsonb_agg(jsonb_build_object('work_date',schedule.work_date,'starts_at',schedule.starts_at,'ends_at',schedule.ends_at,'shift_name',schedule.shift_name,'is_day_off',schedule.is_day_off) order by schedule.work_date,schedule.starts_at),'[]'::jsonb) from public.timefit_user_work_schedules schedule where schedule.staff_id=request.staff_id and schedule.work_date between request.starts_on and request.ends_on and schedule.status<>'cancelled') end,
        'attendance',case when public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'attendance.view') or public.timefit_user_has_management_permission(p_organization_id,'attendance.manage') or public.timefit_user_has_management_permission(p_organization_id,'attendance.review_correction') then
          (select jsonb_build_object('work_date',attendance.work_date,'checked_in_at',attendance.checked_in_at,'checked_out_at',attendance.checked_out_at,'status',attendance.status) from public.timefit_user_attendance_records attendance where attendance.staff_id=request.staff_id and attendance.work_date=request.starts_on) end
      ) context
    from public.timefit_user_leave_requests request join public.timefit_user_staff staff on staff.id=request.staff_id
    left join public.timefit_user_accounts account on account.id=staff.user_id left join public.timefit_user_staff_categories category on category.id=staff.category_id
    where request.organization_id=p_organization_id and request.status<>'cancelled'
      and public.timefit_user_mobile_can_review_staff(p_organization_id,request.staff_id,'leave.review')
    union all
    select schedule.id,'schedule',schedule.approval_status,schedule.staff_id,coalesce(account.display_name,staff.display_name,'직원'),category.name,
      schedule.work_date,schedule.work_date,coalesce(nullif(schedule.shift_name,''),'근무 일정'),
      case when schedule.is_day_off then '휴무' else concat(to_char(schedule.starts_at,'HH24:MI'),' ~ ',to_char(schedule.ends_at,'HH24:MI')) end,
      schedule.manager_note,schedule.review_comment,coalesce(schedule.submitted_at,schedule.created_at),schedule.reviewed_at,
      jsonb_build_object(
        'leave_balance',case when public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'leave.view') or public.timefit_user_has_management_permission(p_organization_id,'leave.review') then
          jsonb_build_object('granted',coalesce((select sum(grant_item.amount) from public.timefit_user_leave_grants grant_item where grant_item.staff_id=schedule.staff_id),0),'used',coalesce((select sum(used.amount) from public.timefit_user_leave_requests used where used.staff_id=schedule.staff_id and used.status='approved'),0),'pending',coalesce((select sum(pending.amount) from public.timefit_user_leave_requests pending where pending.staff_id=schedule.staff_id and pending.status='pending'),0)) end,
        'schedule',jsonb_build_array(jsonb_build_object('work_date',schedule.work_date,'starts_at',schedule.starts_at,'ends_at',schedule.ends_at,'shift_name',schedule.shift_name,'is_day_off',schedule.is_day_off)),
        'attendance',case when public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'attendance.view') or public.timefit_user_has_management_permission(p_organization_id,'attendance.manage') or public.timefit_user_has_management_permission(p_organization_id,'attendance.review_correction') then
          (select jsonb_build_object('work_date',attendance.work_date,'checked_in_at',attendance.checked_in_at,'checked_out_at',attendance.checked_out_at,'status',attendance.status) from public.timefit_user_attendance_records attendance where attendance.staff_id=schedule.staff_id and attendance.work_date=schedule.work_date) end
      )
    from public.timefit_user_work_schedules schedule join public.timefit_user_staff staff on staff.id=schedule.staff_id
    left join public.timefit_user_accounts account on account.id=staff.user_id left join public.timefit_user_staff_categories category on category.id=staff.category_id
    where schedule.organization_id=p_organization_id and public.timefit_user_mobile_can_review_staff(p_organization_id,schedule.staff_id,'schedule.approve')
    union all
    select correction.id,'attendance',correction.status,correction.staff_id,coalesce(account.display_name,staff.display_name,'직원'),category.name,
      correction.work_date,correction.work_date,'근태 정정',concat(to_char(correction.requested_checked_in_at at time zone v_timezone,'HH24:MI'),' ~ ',coalesce(to_char(correction.requested_checked_out_at at time zone v_timezone,'HH24:MI'),'미퇴근')),
      correction.reason,correction.review_comment,correction.created_at,correction.reviewed_at,
      jsonb_build_object(
        'leave_balance',case when public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'leave.view') or public.timefit_user_has_management_permission(p_organization_id,'leave.review') then
          jsonb_build_object('granted',coalesce((select sum(grant_item.amount) from public.timefit_user_leave_grants grant_item where grant_item.staff_id=correction.staff_id),0),'used',coalesce((select sum(used.amount) from public.timefit_user_leave_requests used where used.staff_id=correction.staff_id and used.status='approved'),0),'pending',coalesce((select sum(pending.amount) from public.timefit_user_leave_requests pending where pending.staff_id=correction.staff_id and pending.status='pending'),0)) end,
        'schedule',case when public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'schedule.view') or public.timefit_user_has_management_permission(p_organization_id,'schedule.manage') or public.timefit_user_has_management_permission(p_organization_id,'schedule.approve') then
          (select coalesce(jsonb_agg(jsonb_build_object('work_date',item.work_date,'starts_at',item.starts_at,'ends_at',item.ends_at,'shift_name',item.shift_name,'is_day_off',item.is_day_off) order by item.starts_at),'[]'::jsonb) from public.timefit_user_work_schedules item where item.staff_id=correction.staff_id and item.work_date=correction.work_date and item.status<>'cancelled') end,
        'attendance',jsonb_build_object('work_date',correction.work_date,'checked_in_at',record.checked_in_at,'checked_out_at',record.checked_out_at,'status',record.status,
          'requested_checked_in_at',correction.requested_checked_in_at,'requested_checked_out_at',correction.requested_checked_out_at,'updated_at',record.updated_at)
      )
    from public.timefit_user_attendance_correction_requests correction join public.timefit_user_staff staff on staff.id=correction.staff_id
    left join public.timefit_user_accounts account on account.id=staff.user_id left join public.timefit_user_staff_categories category on category.id=staff.category_id
    left join public.timefit_user_attendance_records record on record.staff_id=correction.staff_id and record.work_date=correction.work_date
    where correction.organization_id=p_organization_id and correction.status<>'cancelled'
      and public.timefit_user_mobile_can_review_staff(p_organization_id,correction.staff_id,'attendance.review_correction')
  ), limited as (select * from accessible order by case when status='pending' then 0 else 1 end,submitted_at desc limit 200)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'kind',kind,'status',status,'staff_id',staff_id,'staff_name',staff_name,'category_name',category_name,
    'starts_on',starts_on,'ends_on',ends_on,'title',title,'detail',detail,'reason',reason,'review_comment',review_comment,
    'submitted_at',submitted_at,'reviewed_at',reviewed_at,'context',context
  ) order by case when status='pending' then 0 else 1 end,submitted_at desc),'[]'::jsonb),
  count(*) filter(where status='pending'),count(*) filter(where status='approved'),count(*) filter(where status='rejected')
  into v_items,v_pending,v_approved,v_rejected from limited;
  return jsonb_build_object('data',jsonb_build_object('timezone',v_timezone,'counts',jsonb_build_object('pending',v_pending,'approved',v_approved,'rejected',v_rejected),'items',v_items),
    'meta',jsonb_build_object('contract_version','2.0','server_time',now(),'request_id',gen_random_uuid()));
end $$;

create or replace function public.timefit_user_mobile_review_approval(
  p_organization_id uuid,p_kind text,p_request_id uuid,p_decision text,p_comment text,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing jsonb;v_staff_id uuid;v_status text;v_result jsonb;v_recipient uuid;
  v_correction public.timefit_user_attendance_correction_requests;v_record public.timefit_user_attendance_records;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_kind not in ('leave','schedule','attendance') or p_decision not in ('approved','rejected') or p_request_key is null then raise exception using errcode='22023',message='invalid_approval_request';end if;
  if length(coalesce(p_comment,''))>500 or (p_decision='rejected' and length(trim(coalesce(p_comment,'')))<2) then raise exception using errcode='22023',message='invalid_review_comment';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_key::text,6));
  select result into v_existing from public.timefit_user_mobile_approval_actions where actor_id=auth.uid() and request_key=p_request_key;
  if v_existing is not null then return v_existing||jsonb_build_object('duplicate',true);end if;
  if p_kind='leave' then
    select staff_id,status::text into v_staff_id,v_status from public.timefit_user_leave_requests where id=p_request_id and organization_id=p_organization_id for update;
    if v_staff_id is null or not public.timefit_user_mobile_can_review_staff(p_organization_id,v_staff_id,'leave.review') then raise exception using errcode='42501',message='approval_access_denied';end if;
    if v_status<>'pending' then raise exception using errcode='40001',message='approval_already_processed';end if;
    update public.timefit_user_leave_requests set status=p_decision::public.timefit_user_leave_status,review_comment=nullif(trim(p_comment),''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      where id=p_request_id returning jsonb_build_object('id',id,'kind','leave','status',status,'review_comment',review_comment,'reviewed_at',reviewed_at) into v_result;
  elsif p_kind='schedule' then
    select staff_id,approval_status into v_staff_id,v_status from public.timefit_user_work_schedules where id=p_request_id and organization_id=p_organization_id for update;
    if v_staff_id is null or not public.timefit_user_mobile_can_review_staff(p_organization_id,v_staff_id,'schedule.approve') then raise exception using errcode='42501',message='approval_access_denied';end if;
    if v_status<>'pending' then raise exception using errcode='40001',message='approval_already_processed';end if;
    update public.timefit_user_work_schedules set approval_status=p_decision,review_comment=nullif(trim(p_comment),''),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
      where id=p_request_id returning jsonb_build_object('id',id,'kind','schedule','status',approval_status,'review_comment',review_comment,'reviewed_at',reviewed_at) into v_result;
  else
    select * into v_correction from public.timefit_user_attendance_correction_requests where id=p_request_id and organization_id=p_organization_id for update;
    v_staff_id:=v_correction.staff_id;v_status:=v_correction.status;
    if v_staff_id is null or not public.timefit_user_mobile_can_review_staff(p_organization_id,v_staff_id,'attendance.review_correction') then raise exception using errcode='42501',message='approval_access_denied';end if;
    if v_status<>'pending' then raise exception using errcode='40001',message='approval_already_processed';end if;
    select * into v_record from public.timefit_user_attendance_records where staff_id=v_staff_id and work_date=v_correction.work_date for update;
    if v_record.updated_at is distinct from v_correction.expected_attendance_updated_at then raise exception using errcode='40001',message='approval_context_changed';end if;
    if p_decision='approved' then
      perform public.timefit_user_correct_attendance(p_organization_id,v_staff_id,v_correction.work_date,v_correction.requested_checked_in_at,v_correction.requested_checked_out_at,v_correction.reason,v_correction.expected_attendance_updated_at);
    end if;
    update public.timefit_user_attendance_correction_requests set status=p_decision,review_comment=nullif(trim(p_comment),''),reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_request_id returning jsonb_build_object('id',id,'kind','attendance','status',status,'review_comment',review_comment,'reviewed_at',reviewed_at) into v_result;
  end if;
  v_result:=v_result||jsonb_build_object('duplicate',false);
  insert into public.timefit_user_mobile_approval_actions(organization_id,actor_id,request_key,item_kind,item_id,decision,result)
    values(p_organization_id,auth.uid(),p_request_key,p_kind,p_request_id,p_decision,v_result);
  select user_id into v_recipient from public.timefit_user_staff where id=v_staff_id;
  if v_recipient is not null then
    insert into public.timefit_user_notifications(organization_id,recipient_user_id,notification_type,title,body,deeplink_path,dedupe_key,metadata)
    values(p_organization_id,v_recipient,'approval_result',case when p_decision='approved' then '요청이 승인됐어요' else '요청이 반려됐어요' end,
      case p_kind when 'leave' then '휴가 요청' when 'schedule' then '스케줄 요청' else '근태 정정 요청' end||' 결과를 확인해 주세요.',
      case p_kind when 'leave' then '/#requests' when 'schedule' then '/#schedule' else '/#attendance' end,
      concat('approval-result:',p_kind,':',p_request_id,':',p_decision),jsonb_build_object('kind',p_kind,'requestId',p_request_id,'decision',p_decision))
    on conflict(recipient_user_id,dedupe_key) do nothing;
  end if;
  return v_result;
end $$;

revoke all on function public.timefit_user_mobile_request_attendance_correction(uuid,date,timestamptz,timestamptz,text,uuid) from public;
revoke all on function public.timefit_user_mobile_attendance_correction_requests(uuid) from public;
revoke all on function public.timefit_user_mobile_approval_inbox(uuid) from public;
revoke all on function public.timefit_user_mobile_review_approval(uuid,text,uuid,text,text,uuid) from public;
grant execute on function public.timefit_user_mobile_request_attendance_correction(uuid,date,timestamptz,timestamptz,text,uuid) to authenticated;
grant execute on function public.timefit_user_mobile_attendance_correction_requests(uuid) to authenticated;
grant execute on function public.timefit_user_mobile_approval_inbox(uuid) to authenticated;
grant execute on function public.timefit_user_mobile_review_approval(uuid,text,uuid,text,text,uuid) to authenticated;
select pg_notify('pgrst','reload schema');
