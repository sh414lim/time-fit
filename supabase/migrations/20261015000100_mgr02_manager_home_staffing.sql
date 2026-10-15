-- MGR-02: persistent staffing requirements and scoped mobile home coverage summary.
create unique index if not exists timefit_user_staff_categories_org_id_unique
  on public.timefit_user_staff_categories(organization_id,id);

create table if not exists public.timefit_user_staffing_requirements (
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  category_id uuid not null,
  weekday smallint not null check(weekday between 0 and 6),
  required_count integer not null check(required_count between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,category_id,weekday),
  foreign key(organization_id,category_id)
    references public.timefit_user_staff_categories(organization_id,id) on delete cascade
);

alter table public.timefit_user_staffing_requirements enable row level security;

create or replace function public.timefit_user_mobile_can_access_staffing_category(p_organization_id uuid,p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select auth.uid() is not null and (
    public.timefit_user_is_organization_owner(p_organization_id)
    or exists(
      select 1
      from public.timefit_user_management_accounts account
      where account.organization_id=p_organization_id
        and account.user_id=auth.uid()
        and account.status='active'
        and (
          not exists(
            select 1 from public.timefit_user_management_scopes scope
            where scope.management_account_id=account.id
          )
          or exists(
            select 1 from public.timefit_user_management_scopes scope
            where scope.management_account_id=account.id and scope.category_id=p_category_id
          )
        )
    )
  );
$$;

drop policy if exists "staffing requirements managers read" on public.timefit_user_staffing_requirements;
create policy "staffing requirements managers read" on public.timefit_user_staffing_requirements
  for select using(
    (
      public.timefit_user_is_organization_owner(organization_id)
      or public.timefit_user_has_management_permission(organization_id,'schedule.view')
      or public.timefit_user_has_management_permission(organization_id,'schedule.manage')
    ) and public.timefit_user_mobile_can_access_staffing_category(organization_id,category_id)
  );

drop policy if exists "staffing requirements managers manage" on public.timefit_user_staffing_requirements;
create policy "staffing requirements managers manage" on public.timefit_user_staffing_requirements
  for all using(
    (
      public.timefit_user_is_organization_owner(organization_id)
      or public.timefit_user_has_management_permission(organization_id,'schedule.manage')
    ) and public.timefit_user_mobile_can_access_staffing_category(organization_id,category_id)
  ) with check(
    (
      public.timefit_user_is_organization_owner(organization_id)
      or public.timefit_user_has_management_permission(organization_id,'schedule.manage')
    ) and public.timefit_user_mobile_can_access_staffing_category(organization_id,category_id)
  );

drop trigger if exists timefit_user_staffing_requirements_updated_at on public.timefit_user_staffing_requirements;
create trigger timefit_user_staffing_requirements_updated_at
  before update on public.timefit_user_staffing_requirements
  for each row execute procedure public.set_updated_at();

grant select,insert,update,delete on public.timefit_user_staffing_requirements to authenticated;

create or replace function public.timefit_user_mobile_manager_staffing_summary(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_timezone text;
  v_today date;
  v_days jsonb;
  v_configured boolean;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_organization_id is null then
    raise exception using errcode='22023',message='organization_required';
  end if;
  if not public.timefit_user_is_organization_owner(p_organization_id)
     and not public.timefit_user_has_management_permission(p_organization_id,'schedule.view')
     and not public.timefit_user_has_management_permission(p_organization_id,'schedule.manage') then
    raise exception using errcode='42501',message='staffing_summary_access_denied';
  end if;

  select coalesce(settings.timezone,'Asia/Seoul') into v_timezone
  from public.timefit_user_organizations organization
  left join public.timefit_user_organization_settings settings on settings.organization_id=organization.id
  where organization.id=p_organization_id;
  if v_timezone is null then
    raise exception using errcode='P0002',message='organization_not_found';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  select exists(
    select 1 from public.timefit_user_staffing_requirements requirement
    where requirement.organization_id=p_organization_id
      and requirement.required_count>0
      and public.timefit_user_mobile_can_access_staffing_category(p_organization_id,requirement.category_id)
  ) into v_configured;

  with days(work_date) as (
    values(v_today),(v_today+1)
  )
  select jsonb_agg(jsonb_build_object(
    'date',day.work_date,
    'scheduled_count',(
      select count(*)
      from public.timefit_user_work_schedules schedule
      join public.timefit_user_staff staff on staff.id=schedule.staff_id
      where schedule.organization_id=p_organization_id
        and schedule.work_date=day.work_date
        and schedule.status='published'
        and schedule.approval_status='approved'
        and not schedule.is_day_off
        and (public.timefit_user_is_organization_owner(p_organization_id)
          or public.timefit_user_management_can_access_staff(p_organization_id,staff.id))
    ),
    'required_count',coalesce((
      select sum(requirement.required_count)
      from public.timefit_user_staffing_requirements requirement
      where requirement.organization_id=p_organization_id
        and requirement.weekday=extract(dow from day.work_date)::smallint
        and public.timefit_user_mobile_can_access_staffing_category(p_organization_id,requirement.category_id)
    ),0),
    'shortages',coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id',requirement.category_id,
        'category_name',category.name,
        'required_count',requirement.required_count,
        'scheduled_count',(
          select count(*)
          from public.timefit_user_work_schedules schedule
          join public.timefit_user_staff staff on staff.id=schedule.staff_id
          where schedule.organization_id=p_organization_id
            and schedule.work_date=day.work_date
            and schedule.status='published'
            and schedule.approval_status='approved'
            and not schedule.is_day_off
            and staff.category_id=requirement.category_id
            and (public.timefit_user_is_organization_owner(p_organization_id)
              or public.timefit_user_management_can_access_staff(p_organization_id,staff.id))
        )
      ) order by category.sort_order,category.name)
      from public.timefit_user_staffing_requirements requirement
      join public.timefit_user_staff_categories category on category.id=requirement.category_id
      where requirement.organization_id=p_organization_id
        and requirement.weekday=extract(dow from day.work_date)::smallint
        and public.timefit_user_mobile_can_access_staffing_category(p_organization_id,requirement.category_id)
        and requirement.required_count>(
          select count(*)
          from public.timefit_user_work_schedules schedule
          join public.timefit_user_staff staff on staff.id=schedule.staff_id
          where schedule.organization_id=p_organization_id
            and schedule.work_date=day.work_date
            and schedule.status='published'
            and schedule.approval_status='approved'
            and not schedule.is_day_off
            and staff.category_id=requirement.category_id
            and (public.timefit_user_is_organization_owner(p_organization_id)
              or public.timefit_user_management_can_access_staff(p_organization_id,staff.id))
        )
    ),'[]'::jsonb)
  ) order by day.work_date) into v_days
  from days day;

  return jsonb_build_object(
    'data',jsonb_build_object(
      'timezone',v_timezone,
      'configured',v_configured,
      'days',coalesce(v_days,'[]'::jsonb)
    ),
    'meta',jsonb_build_object(
      'contract_version','1.0',
      'server_time',now(),
      'request_id',gen_random_uuid()
    )
  );
end $$;

revoke all on function public.timefit_user_mobile_manager_staffing_summary(uuid) from public;
revoke all on function public.timefit_user_mobile_can_access_staffing_category(uuid,uuid) from public;
grant execute on function public.timefit_user_mobile_manager_staffing_summary(uuid) to authenticated;

select pg_notify('pgrst','reload schema');
