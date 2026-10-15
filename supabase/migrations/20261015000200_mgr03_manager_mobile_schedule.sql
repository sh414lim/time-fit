-- MGR-03: scoped manager mobile schedule range and idempotent single-item writes.
alter table public.timefit_user_work_schedules
  add column if not exists manager_note text check(char_length(manager_note)<=500);

create or replace function public.timefit_user_schedule_revision_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_previous jsonb;v_current jsonb;
begin
  if (old.work_date,old.starts_at,old.ends_at,old.break_minutes,old.shift_name,old.is_day_off,old.status,old.approval_status,old.manager_note)
    is not distinct from
    (new.work_date,new.starts_at,new.ends_at,new.break_minutes,new.shift_name,new.is_day_off,new.status,new.approval_status,new.manager_note)
  then return new;end if;
  new.schedule_revision:=old.schedule_revision+1;
  v_previous:=jsonb_build_object('work_date',old.work_date,'starts_at',old.starts_at,'ends_at',old.ends_at,'break_minutes',old.break_minutes,'shift_name',old.shift_name,'is_day_off',old.is_day_off,'manager_note',old.manager_note);
  v_current:=jsonb_build_object('work_date',new.work_date,'starts_at',new.starts_at,'ends_at',new.ends_at,'break_minutes',new.break_minutes,'shift_name',new.shift_name,'is_day_off',new.is_day_off,'manager_note',new.manager_note);
  insert into public.timefit_user_schedule_versions(organization_id,schedule_id,staff_id,schedule_revision,previous_values,current_values,changed_by)
  values(new.organization_id,new.id,new.staff_id,new.schedule_revision,v_previous,v_current,auth.uid());
  return new;
end $$;

create table if not exists public.timefit_user_mobile_schedule_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  action_kind text not null check(action_kind in ('save','cancel')),
  schedule_id uuid references public.timefit_user_work_schedules(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id,request_key)
);

alter table public.timefit_user_mobile_schedule_actions enable row level security;
drop policy if exists "mobile schedule actors read own actions" on public.timefit_user_mobile_schedule_actions;
create policy "mobile schedule actors read own actions" on public.timefit_user_mobile_schedule_actions
  for select using(actor_id=auth.uid());
grant select on public.timefit_user_mobile_schedule_actions to authenticated;
grant all on public.timefit_user_mobile_schedule_actions to service_role;

-- Compare absolute local timestamp ranges so overnight shifts also collide with
-- an adjacent calendar day's schedule.
create or replace function public.timefit_user_schedule_overlap_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_start timestamp;v_end timestamp;
begin
  if new.status='cancelled' then return new;end if;
  if new.is_day_off then
    if exists(select 1 from public.timefit_user_work_schedules existing
      where existing.staff_id=new.staff_id and existing.work_date=new.work_date
        and existing.id<>new.id and existing.status<>'cancelled') then
      raise exception using errcode='23P01',message='schedule_time_conflict';
    end if;
    return new;
  end if;
  v_start:=new.work_date+new.starts_at;
  v_end:=new.work_date+new.ends_at+case when new.ends_at<=new.starts_at then interval '1 day' else interval '0 day' end;
  if exists(
    select 1 from public.timefit_user_work_schedules existing
    where existing.staff_id=new.staff_id
      and existing.id<>new.id
      and existing.status<>'cancelled'
      and existing.work_date between new.work_date-1 and new.work_date+1
      and (
        existing.is_day_off and existing.work_date=new.work_date
        or not existing.is_day_off and tsrange(
          existing.work_date+existing.starts_at,
          existing.work_date+existing.ends_at+case when existing.ends_at<=existing.starts_at then interval '1 day' else interval '0 day' end,
          '[)'
        ) && tsrange(v_start,v_end,'[)')
      )
  ) then raise exception using errcode='23P01',message='schedule_time_conflict';end if;
  return new;
end $$;

create or replace function public.timefit_user_mobile_manager_schedule_range(p_organization_id uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_timezone text;v_staff jsonb;v_items jsonb;v_leaves jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>35 then raise exception using errcode='22023',message='invalid_schedule_range';end if;
  if not public.timefit_user_is_organization_owner(p_organization_id)
    and not public.timefit_user_has_management_permission(p_organization_id,'schedule.view')
    and not public.timefit_user_has_management_permission(p_organization_id,'schedule.manage') then
    raise exception using errcode='42501',message='schedule_view_denied';
  end if;
  select coalesce(settings.timezone,'Asia/Seoul') into v_timezone
  from public.timefit_user_organizations organization left join public.timefit_user_organization_settings settings on settings.organization_id=organization.id
  where organization.id=p_organization_id;
  if v_timezone is null then raise exception using errcode='P0002',message='organization_not_found';end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',staff.id,'name',coalesce(account.display_name,staff.display_name,'직원'),'category_id',staff.category_id,
    'category_name',category.name,'job_title',staff.job_title
  ) order by category.sort_order nulls last,staff.sort_order nulls last,coalesce(account.display_name,staff.display_name)),'[]'::jsonb)
  into v_staff
  from public.timefit_user_staff staff
  left join public.timefit_user_accounts account on account.id=staff.user_id
  left join public.timefit_user_staff_categories category on category.id=staff.category_id
  where staff.organization_id=p_organization_id
    and (public.timefit_user_is_organization_owner(p_organization_id)
      or public.timefit_user_management_can_access_staff(p_organization_id,staff.id));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',schedule.id,'staff_id',schedule.staff_id,'work_date',schedule.work_date,'starts_at',schedule.starts_at,
    'ends_at',schedule.ends_at,'break_minutes',schedule.break_minutes,'shift_name',coalesce(schedule.shift_name,'일반 근무'),
    'is_day_off',schedule.is_day_off,'status',schedule.status,'approval_status',schedule.approval_status,
    'schedule_revision',schedule.schedule_revision,'manager_note',schedule.manager_note,'updated_at',schedule.updated_at
  ) order by schedule.work_date,schedule.starts_at nulls last),'[]'::jsonb) into v_items
  from public.timefit_user_work_schedules schedule
  join public.timefit_user_staff staff on staff.id=schedule.staff_id
  where schedule.organization_id=p_organization_id and schedule.work_date between p_from and p_to and schedule.status<>'cancelled'
    and (public.timefit_user_is_organization_owner(p_organization_id)
      or public.timefit_user_management_can_access_staff(p_organization_id,staff.id));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',request.id,'staff_id',request.staff_id,'starts_on',request.starts_on,'ends_on',request.ends_on,
    'leave_type',request.leave_type,'day_part',request.day_part
  ) order by request.starts_on),'[]'::jsonb) into v_leaves
  from public.timefit_user_leave_requests request
  where request.organization_id=p_organization_id and request.status='approved'
    and request.starts_on<=p_to and request.ends_on>=p_from
    and (public.timefit_user_is_organization_owner(p_organization_id)
      or public.timefit_user_management_can_access_staff(p_organization_id,request.staff_id));

  return jsonb_build_object('data',jsonb_build_object(
    'from',p_from,'to',p_to,'timezone',v_timezone,'staff',v_staff,'items',v_items,'leaves',v_leaves
  ),'meta',jsonb_build_object('contract_version','1.0','server_time',now(),'request_id',gen_random_uuid()));
end $$;

create or replace function public.timefit_user_mobile_manager_save_schedule(
  p_organization_id uuid,p_schedule_id uuid,p_staff_id uuid,p_work_date date,p_starts_at time,p_ends_at time,
  p_break_minutes integer,p_shift_name text,p_is_day_off boolean,p_manager_note text,p_expected_revision integer,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing jsonb;v_schedule public.timefit_user_work_schedules;v_duration integer;v_started_at timestamptz:=clock_timestamp();v_notification text;v_result jsonb;v_recipient uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_request_key is null or p_organization_id is null or p_staff_id is null or p_work_date is null then raise exception using errcode='22023',message='invalid_schedule_request';end if;
  select result into v_existing from public.timefit_user_mobile_schedule_actions where actor_id=auth.uid() and request_key=p_request_key;
  if v_existing is not null then return v_existing||jsonb_build_object('duplicate',true);end if;
  if not public.timefit_user_is_organization_owner(p_organization_id)
    and not public.timefit_user_has_management_permission(p_organization_id,'schedule.manage') then raise exception using errcode='42501',message='schedule_manage_denied';end if;
  if not exists(select 1 from public.timefit_user_staff staff where staff.id=p_staff_id and staff.organization_id=p_organization_id
    and (public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_management_can_access_staff(p_organization_id,staff.id))) then
    raise exception using errcode='42501',message='schedule_staff_access_denied';
  end if;
  if length(trim(coalesce(p_shift_name,'')))>80 or length(coalesce(p_manager_note,''))>500
    or coalesce(p_break_minutes,0)<0 or coalesce(p_break_minutes,0)>480 then raise exception using errcode='22023',message='invalid_schedule_request';end if;
  if coalesce(p_is_day_off,false) then
    if p_starts_at is not null or p_ends_at is not null then raise exception using errcode='22023',message='invalid_day_off_schedule';end if;
  else
    if p_starts_at is null or p_ends_at is null or p_starts_at=p_ends_at then raise exception using errcode='22023',message='invalid_schedule_window';end if;
    v_duration:=extract(epoch from (p_ends_at-p_starts_at))/60+case when p_ends_at<p_starts_at then 1440 else 0 end;
    if coalesce(p_break_minutes,0)>=v_duration then raise exception using errcode='22023',message='invalid_break_minutes';end if;
    if exists(select 1 from public.timefit_user_leave_requests request where request.staff_id=p_staff_id and request.status='approved'
      and (
        (p_work_date between request.starts_on and request.ends_on
          and (request.day_part='full' or request.day_part='am' and p_starts_at<'13:00' or request.day_part='pm' and (p_ends_at>'13:00' or p_ends_at<p_starts_at)))
        or (p_ends_at<p_starts_at and p_work_date+1 between request.starts_on and request.ends_on and request.day_part in ('full','am'))
      )) then
      raise exception using errcode='23P01',message='schedule_leave_conflict';
    end if;
  end if;

  if p_schedule_id is null then
    insert into public.timefit_user_work_schedules(organization_id,staff_id,work_date,starts_at,ends_at,break_minutes,shift_name,is_day_off,manager_note,status,created_by)
    values(p_organization_id,p_staff_id,p_work_date,case when p_is_day_off then null else p_starts_at end,case when p_is_day_off then null else p_ends_at end,
      case when p_is_day_off then 0 else coalesce(p_break_minutes,0) end,coalesce(nullif(trim(p_shift_name),''),case when p_is_day_off then '휴무' else '일반 근무' end),coalesce(p_is_day_off,false),nullif(trim(p_manager_note),''),'published',auth.uid())
    returning * into v_schedule;
  else
    select * into v_schedule from public.timefit_user_work_schedules where id=p_schedule_id and organization_id=p_organization_id for update;
    if v_schedule.id is null or v_schedule.staff_id<>p_staff_id
      or (not public.timefit_user_is_organization_owner(p_organization_id) and not public.timefit_user_management_can_access_staff(p_organization_id,v_schedule.staff_id)) then
      raise exception using errcode='42501',message='schedule_access_denied';
    end if;
    if p_expected_revision is null or v_schedule.schedule_revision<>p_expected_revision then raise exception using errcode='40001',message='schedule_revision_changed';end if;
    update public.timefit_user_work_schedules set work_date=p_work_date,starts_at=case when p_is_day_off then null else p_starts_at end,
      ends_at=case when p_is_day_off then null else p_ends_at end,break_minutes=case when p_is_day_off then 0 else coalesce(p_break_minutes,0) end,
      shift_name=coalesce(nullif(trim(p_shift_name),''),case when p_is_day_off then '휴무' else '일반 근무' end),is_day_off=coalesce(p_is_day_off,false),manager_note=nullif(trim(p_manager_note),''),status='published',updated_at=now()
      where id=p_schedule_id returning * into v_schedule;
  end if;

  select user_id into v_recipient from public.timefit_user_staff where id=v_schedule.staff_id;
  v_notification:=case when v_schedule.approval_status='pending' then 'awaiting_approval' when v_recipient is null then 'unavailable'
    when exists(select 1 from public.timefit_user_schedule_notification_outbox where schedule_id=v_schedule.id and created_at>=v_started_at) then 'queued' else 'unchanged' end;
  v_result:=jsonb_build_object('schedule',to_jsonb(v_schedule),'notification_status',v_notification,'duplicate',false);
  insert into public.timefit_user_mobile_schedule_actions(organization_id,actor_id,request_key,action_kind,schedule_id,result)
  values(p_organization_id,auth.uid(),p_request_key,'save',v_schedule.id,v_result);
  return v_result;
end $$;

create or replace function public.timefit_user_mobile_manager_cancel_schedule(
  p_organization_id uuid,p_schedule_id uuid,p_expected_revision integer,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing jsonb;v_schedule public.timefit_user_work_schedules;v_started_at timestamptz:=clock_timestamp();v_notification text;v_result jsonb;v_recipient uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_request_key is null or p_schedule_id is null then raise exception using errcode='22023',message='invalid_schedule_request';end if;
  select result into v_existing from public.timefit_user_mobile_schedule_actions where actor_id=auth.uid() and request_key=p_request_key;
  if v_existing is not null then return v_existing||jsonb_build_object('duplicate',true);end if;
  if not public.timefit_user_is_organization_owner(p_organization_id)
    and not public.timefit_user_has_management_permission(p_organization_id,'schedule.manage') then raise exception using errcode='42501',message='schedule_manage_denied';end if;
  select * into v_schedule from public.timefit_user_work_schedules where id=p_schedule_id and organization_id=p_organization_id for update;
  if v_schedule.id is null or (not public.timefit_user_is_organization_owner(p_organization_id)
    and not public.timefit_user_management_can_access_staff(p_organization_id,v_schedule.staff_id)) then raise exception using errcode='42501',message='schedule_access_denied';end if;
  if p_expected_revision is null or v_schedule.schedule_revision<>p_expected_revision then raise exception using errcode='40001',message='schedule_revision_changed';end if;
  update public.timefit_user_work_schedules set status='cancelled',updated_at=now() where id=p_schedule_id returning * into v_schedule;
  select user_id into v_recipient from public.timefit_user_staff where id=v_schedule.staff_id;
  v_notification:=case when v_recipient is null then 'unavailable'
    when exists(select 1 from public.timefit_user_schedule_notification_outbox where schedule_id=v_schedule.id and created_at>=v_started_at) then 'queued' else 'unchanged' end;
  v_result:=jsonb_build_object('schedule',to_jsonb(v_schedule),'notification_status',v_notification,'duplicate',false);
  insert into public.timefit_user_mobile_schedule_actions(organization_id,actor_id,request_key,action_kind,schedule_id,result)
  values(p_organization_id,auth.uid(),p_request_key,'cancel',v_schedule.id,v_result);
  return v_result;
end $$;

revoke all on function public.timefit_user_mobile_manager_schedule_range(uuid,date,date) from public;
revoke all on function public.timefit_user_mobile_manager_save_schedule(uuid,uuid,uuid,date,time,time,integer,text,boolean,text,integer,uuid) from public;
revoke all on function public.timefit_user_mobile_manager_cancel_schedule(uuid,uuid,integer,uuid) from public;
grant execute on function public.timefit_user_mobile_manager_schedule_range(uuid,date,date) to authenticated;
grant execute on function public.timefit_user_mobile_manager_save_schedule(uuid,uuid,uuid,date,time,time,integer,text,boolean,text,integer,uuid) to authenticated;
grant execute on function public.timefit_user_mobile_manager_cancel_schedule(uuid,uuid,integer,uuid) to authenticated;

select pg_notify('pgrst','reload schema');
