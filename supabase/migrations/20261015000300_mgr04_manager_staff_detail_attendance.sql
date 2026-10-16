-- MGR-04: permission-filtered staff directory, integrated detail and audited attendance corrections.

create table if not exists public.timefit_user_mobile_attendance_correction_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id,request_key)
);
alter table public.timefit_user_mobile_attendance_correction_actions enable row level security;
drop policy if exists "mobile correction actors read own actions" on public.timefit_user_mobile_attendance_correction_actions;
create policy "mobile correction actors read own actions" on public.timefit_user_mobile_attendance_correction_actions
  for select using(actor_id=auth.uid());
grant select on public.timefit_user_mobile_attendance_correction_actions to authenticated;
grant all on public.timefit_user_mobile_attendance_correction_actions to service_role;

create or replace function public.timefit_user_mobile_manager_staff_directory(
  p_organization_id uuid,p_search text default null,p_category_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_timezone text;v_today date;v_staff jsonb;v_categories jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  if not public.timefit_user_is_organization_owner(p_organization_id) and not (
    public.timefit_user_has_management_permission(p_organization_id,'employee.view')
    or public.timefit_user_has_management_permission(p_organization_id,'employee.manage')
    or public.timefit_user_has_management_permission(p_organization_id,'attendance.view')
    or public.timefit_user_has_management_permission(p_organization_id,'attendance.manage')
    or public.timefit_user_has_management_permission(p_organization_id,'schedule.view')
    or public.timefit_user_has_management_permission(p_organization_id,'schedule.manage')
    or public.timefit_user_has_management_permission(p_organization_id,'leave.view')
    or public.timefit_user_has_management_permission(p_organization_id,'leave.review')
  ) then raise exception using errcode='42501',message='staff_directory_denied';end if;
  select coalesce(settings.timezone,'Asia/Seoul') into v_timezone from public.timefit_user_organizations organization
  left join public.timefit_user_organization_settings settings on settings.organization_id=organization.id where organization.id=p_organization_id;
  if v_timezone is null then raise exception using errcode='P0002',message='organization_not_found';end if;
  v_today:=(now() at time zone v_timezone)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',staff.id,'name',coalesce(account.display_name,staff.display_name,'직원'),'category_id',staff.category_id,
    'category_name',category.name,'category_color',category.color,'job_title',staff.job_title,'joined_on',staff.joined_on,
    'employment_status','active','has_app_account',staff.user_id is not null,'today_status',case
      when attendance.checked_out_at is not null then 'completed' when attendance.checked_in_at is not null then 'working'
      when schedule.id is not null then 'scheduled' else 'none' end
  ) order by category.sort_order nulls last,staff.sort_order,coalesce(account.display_name,staff.display_name)),'[]'::jsonb) into v_staff
  from public.timefit_user_staff staff
  left join public.timefit_user_accounts account on account.id=staff.user_id
  left join public.timefit_user_staff_categories category on category.id=staff.category_id
  left join public.timefit_user_attendance_records attendance on attendance.staff_id=staff.id and attendance.work_date=v_today
  left join lateral(select schedule.id from public.timefit_user_work_schedules schedule where schedule.staff_id=staff.id and schedule.work_date=v_today and schedule.status='published' and schedule.approval_status='approved' and not schedule.is_day_off limit 1) schedule on true
  where staff.organization_id=p_organization_id
    and (p_category_id is null or staff.category_id=p_category_id)
    and (nullif(trim(p_search),'') is null or coalesce(account.display_name,staff.display_name,'') ilike '%'||trim(p_search)||'%' or coalesce(staff.job_title,'') ilike '%'||trim(p_search)||'%')
    and (public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_management_can_access_staff(p_organization_id,staff.id));

  select coalesce(jsonb_agg(jsonb_build_object('id',category.id,'name',category.name,'color',category.color) order by category.sort_order,category.name),'[]'::jsonb)
  into v_categories from public.timefit_user_staff_categories category where category.organization_id=p_organization_id;
  return jsonb_build_object('data',jsonb_build_object('timezone',v_timezone,'reference_date',v_today,'staff',v_staff,'categories',v_categories),
    'meta',jsonb_build_object('contract_version','1.0','server_time',now(),'request_id',gen_random_uuid()));
end $$;

create or replace function public.timefit_user_mobile_manager_staff_detail(
  p_organization_id uuid,p_staff_id uuid,p_reference_date date default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_timezone text;v_date date;v_week_from date;v_week_to date;v_basic jsonb;v_attendance jsonb;v_schedule jsonb;v_leave jsonb;v_history jsonb;v_compensation jsonb;v_result jsonb;
  v_can_attendance boolean;v_can_schedule boolean;v_can_leave boolean;v_can_compensation boolean;v_can_employee boolean;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
  v_can_employee:=public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'employee.view') or public.timefit_user_has_management_permission(p_organization_id,'employee.manage');
  v_can_attendance:=public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'attendance.view') or public.timefit_user_has_management_permission(p_organization_id,'attendance.manage') or public.timefit_user_has_management_permission(p_organization_id,'attendance.review_correction');
  v_can_schedule:=public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'schedule.view') or public.timefit_user_has_management_permission(p_organization_id,'schedule.manage');
  v_can_leave:=public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'leave.view') or public.timefit_user_has_management_permission(p_organization_id,'leave.review');
  v_can_compensation:=public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'employee.compensation.view');
  if not (v_can_employee or v_can_attendance or v_can_schedule or v_can_leave) then raise exception using errcode='42501',message='staff_detail_denied';end if;
  if not exists(select 1 from public.timefit_user_staff staff where staff.id=p_staff_id and staff.organization_id=p_organization_id
    and (public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_management_can_access_staff(p_organization_id,staff.id))) then
    raise exception using errcode='42501',message='staff_detail_denied';end if;
  select coalesce(settings.timezone,'Asia/Seoul') into v_timezone from public.timefit_user_organizations organization
  left join public.timefit_user_organization_settings settings on settings.organization_id=organization.id where organization.id=p_organization_id;
  v_date:=coalesce(p_reference_date,(now() at time zone v_timezone)::date);v_week_from:=date_trunc('week',v_date)::date;v_week_to:=v_week_from+6;

  select jsonb_build_object('id',staff.id,'name',coalesce(account.display_name,staff.display_name,'직원'),'category_id',staff.category_id,
    'category_name',category.name,'category_color',category.color,'job_title',staff.job_title,'joined_on',staff.joined_on,
    'employment_status','active','has_app_account',staff.user_id is not null)
  into v_basic from public.timefit_user_staff staff left join public.timefit_user_accounts account on account.id=staff.user_id
  left join public.timefit_user_staff_categories category on category.id=staff.category_id where staff.id=p_staff_id;

  if v_can_attendance then
    select jsonb_build_object('work_date',v_date,'record_id',attendance.id,'checked_in_at',attendance.checked_in_at,'checked_out_at',attendance.checked_out_at,
      'source',attendance.source,'status',attendance.status,'needs_review',attendance.needs_review,'updated_at',attendance.updated_at,
      'scheduled_start',schedule.starts_at,'scheduled_end',schedule.ends_at,'shift_name',schedule.shift_name)
    into v_attendance from (select 1) seed
    left join public.timefit_user_attendance_records attendance on attendance.staff_id=p_staff_id and attendance.work_date=v_date
    left join lateral(select item.starts_at,item.ends_at,item.shift_name from public.timefit_user_work_schedules item where item.staff_id=p_staff_id and item.work_date=v_date and item.status='published' and item.approval_status='approved' and not item.is_day_off order by item.starts_at limit 1) schedule on true;
  end if;
  if v_can_schedule then
    select coalesce(jsonb_agg(jsonb_build_object('id',item.id,'work_date',item.work_date,'starts_at',item.starts_at,'ends_at',item.ends_at,'break_minutes',item.break_minutes,'shift_name',item.shift_name,'is_day_off',item.is_day_off,'approval_status',item.approval_status) order by item.work_date,item.starts_at),'[]'::jsonb)
    into v_schedule from public.timefit_user_work_schedules item where item.staff_id=p_staff_id and item.work_date between v_week_from and v_week_to and item.status<>'cancelled';
  end if;
  if v_can_leave then
    select jsonb_build_object('granted',coalesce((select sum(amount) from public.timefit_user_leave_grants where staff_id=p_staff_id),0),
      'used',coalesce((select sum(amount) from public.timefit_user_leave_requests where staff_id=p_staff_id and status='approved'),0),
      'pending',coalesce((select sum(amount) from public.timefit_user_leave_requests where staff_id=p_staff_id and status='pending'),0),
      'recent',coalesce((select jsonb_agg(to_jsonb(recent) order by recent.created_at desc) from (select id,starts_on,ends_on,leave_type,day_part,amount,status,created_at from public.timefit_user_leave_requests where staff_id=p_staff_id order by created_at desc limit 5) recent),'[]'::jsonb))
    into v_leave;
  end if;
  select coalesce(jsonb_agg(history.payload order by history.changed_at desc),'[]'::jsonb) into v_history from (
    select correction.created_at changed_at,jsonb_build_object('kind','attendance','changed_at',correction.created_at,'work_date',correction.work_date,'reason',correction.reason,'before',correction.before_record,'after',correction.after_record) payload
    from public.timefit_user_attendance_corrections correction where v_can_attendance and correction.staff_id=p_staff_id
    union all
    select version.changed_at,jsonb_build_object('kind','schedule','changed_at',version.changed_at,'work_date',schedule.work_date,'reason','스케줄 변경','before',version.previous_values,'after',version.current_values)
    from public.timefit_user_schedule_versions version join public.timefit_user_work_schedules schedule on schedule.id=version.schedule_id where v_can_schedule and version.staff_id=p_staff_id
    order by changed_at desc limit 10
  ) history;
  if v_can_compensation then
    select jsonb_build_object('pay_type',staff.pay_type,'hourly_wage',staff.hourly_wage,'daily_wage',staff.daily_wage,'monthly_salary',staff.monthly_salary,'annual_salary',staff.annual_salary)
    into v_compensation from public.timefit_user_staff staff where staff.id=p_staff_id;
  end if;
  v_result:=jsonb_build_object('timezone',v_timezone,'reference_date',v_date,'week_from',v_week_from,'week_to',v_week_to,'basic',v_basic,'capabilities',jsonb_build_object(
    'attendance',v_can_attendance,'attendance_manage',public.timefit_user_is_organization_owner(p_organization_id) or public.timefit_user_has_management_permission(p_organization_id,'attendance.manage'),
    'schedule',v_can_schedule,'leave',v_can_leave,'compensation',v_can_compensation));
  if v_can_attendance then v_result:=v_result||jsonb_build_object('attendance',v_attendance);end if;
  if v_can_schedule then v_result:=v_result||jsonb_build_object('schedule',v_schedule);end if;
  if v_can_leave then v_result:=v_result||jsonb_build_object('leave',v_leave);end if;
  if v_can_attendance or v_can_schedule then v_result:=v_result||jsonb_build_object('history',v_history);end if;
  if v_can_compensation then v_result:=v_result||jsonb_build_object('compensation',v_compensation);end if;
  return jsonb_build_object('data',v_result,'meta',jsonb_build_object('contract_version','1.0','server_time',now(),'request_id',gen_random_uuid()));
end $$;

-- Keep the shared web correction RPC auditable while clearing QR review flags
-- and validating dates in the workplace timezone.
create or replace function public.timefit_user_correct_attendance(
  p_organization_id uuid,p_staff_id uuid,p_work_date date,p_checked_in_at timestamptz,p_checked_out_at timestamptz,
  p_reason text,p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_before public.timefit_user_attendance_records;v_after public.timefit_user_attendance_records;v_timezone text;
begin
  if auth.uid() is null or not (public.timefit_user_is_organization_owner(p_organization_id) or ((public.timefit_user_has_management_permission(p_organization_id,'attendance.manage') or public.timefit_user_has_management_permission(p_organization_id,'attendance.review_correction')) and public.timefit_user_management_can_access_staff(p_organization_id,p_staff_id))) then raise exception using errcode='42501',message='attendance_correction_forbidden';end if;
  perform 1 from public.timefit_user_staff where id=p_staff_id and organization_id=p_organization_id for update;
  if not found then raise exception using errcode='P0002',message='staff_not_found';end if;
  select coalesce(timezone,'Asia/Seoul') into v_timezone from public.timefit_user_organization_settings where organization_id=p_organization_id;v_timezone:=coalesce(v_timezone,'Asia/Seoul');
  if p_work_date is null or p_work_date>(now() at time zone v_timezone)::date or p_checked_in_at is null
    or (p_checked_in_at at time zone v_timezone)::date<>p_work_date or p_checked_in_at>now() or p_checked_out_at>now()
    or (p_checked_out_at is not null and (p_checked_out_at<=p_checked_in_at or p_checked_out_at-p_checked_in_at>interval '48 hours'))
    or length(trim(coalesce(p_reason,'')))<2 or length(p_reason)>500 then raise exception using errcode='22023',message='invalid_attendance_correction';end if;
  select * into v_before from public.timefit_user_attendance_records where staff_id=p_staff_id and work_date=p_work_date for update;
  if v_before.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='attendance_record_changed';end if;
  if v_before.id is null then
    begin insert into public.timefit_user_attendance_records(organization_id,staff_id,work_date,checked_in_at,checked_out_at,source,needs_review)
      values(p_organization_id,p_staff_id,p_work_date,p_checked_in_at,p_checked_out_at,'manager_correction',false) returning * into v_after;
    exception when unique_violation then raise exception using errcode='40001',message='attendance_record_changed';end;
  else
    update public.timefit_user_attendance_records set checked_in_at=p_checked_in_at,checked_out_at=p_checked_out_at,source='manager_correction',needs_review=false
    where id=v_before.id returning * into v_after;
  end if;
  insert into public.timefit_user_attendance_corrections(organization_id,staff_id,work_date,before_record,after_record,reason,corrected_by)
  values(p_organization_id,p_staff_id,p_work_date,case when v_before.id is null then null else to_jsonb(v_before) end,to_jsonb(v_after),trim(p_reason),auth.uid());
  return to_jsonb(v_after);
end $$;

create or replace function public.timefit_user_mobile_manager_correct_attendance(
  p_organization_id uuid,p_staff_id uuid,p_work_date date,p_checked_in_at timestamptz,p_checked_out_at timestamptz,
  p_reason text,p_expected_updated_at timestamptz,p_request_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing jsonb;v_result jsonb;
begin
  if p_request_key is null then raise exception using errcode='22023',message='invalid_attendance_correction';end if;
  select result into v_existing from public.timefit_user_mobile_attendance_correction_actions where actor_id=auth.uid() and request_key=p_request_key;
  if v_existing is not null then return v_existing||jsonb_build_object('duplicate',true);end if;
  if not public.timefit_user_is_organization_owner(p_organization_id) and not (public.timefit_user_has_management_permission(p_organization_id,'attendance.manage') and public.timefit_user_management_can_access_staff(p_organization_id,p_staff_id)) then raise exception using errcode='42501',message='attendance_correction_forbidden';end if;
  v_result:=jsonb_build_object('record',public.timefit_user_correct_attendance(p_organization_id,p_staff_id,p_work_date,p_checked_in_at,p_checked_out_at,p_reason,p_expected_updated_at),'duplicate',false);
  insert into public.timefit_user_mobile_attendance_correction_actions(organization_id,actor_id,request_key,staff_id,result)
  values(p_organization_id,auth.uid(),p_request_key,p_staff_id,v_result);
  return v_result;
end $$;

revoke all on function public.timefit_user_mobile_manager_staff_directory(uuid,text,uuid) from public;
revoke all on function public.timefit_user_mobile_manager_staff_detail(uuid,uuid,date) from public;
revoke all on function public.timefit_user_mobile_manager_correct_attendance(uuid,uuid,date,timestamptz,timestamptz,text,timestamptz,uuid) from public;
grant execute on function public.timefit_user_mobile_manager_staff_directory(uuid,text,uuid) to authenticated;
grant execute on function public.timefit_user_mobile_manager_staff_detail(uuid,uuid,date) to authenticated;
grant execute on function public.timefit_user_mobile_manager_correct_attendance(uuid,uuid,date,timestamptz,timestamptz,text,timestamptz,uuid) to authenticated;
select pg_notify('pgrst','reload schema');
