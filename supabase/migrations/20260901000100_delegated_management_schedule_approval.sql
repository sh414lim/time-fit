-- Delegated manager accounts and owner approval for schedules.
create table if not exists public.timefit_user_management_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  staff_id uuid references public.timefit_user_staff(id) on delete set null,
  login_id text not null,
  role_code text not null check (role_code in ('manager','executive_chef')),
  status text not null default 'active' check (status in ('active','suspended')),
  force_password_change boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, login_id)
);

create table if not exists public.timefit_user_management_permissions (
  management_account_id uuid not null references public.timefit_user_management_accounts(id) on delete cascade,
  permission_code text not null check (permission_code in ('dashboard.view','attendance.view','schedule.view','schedule.manage','leave.view','leave.review','employee.view')),
  allowed boolean not null default true,
  primary key (management_account_id, permission_code)
);

create table if not exists public.timefit_user_management_scopes (
  management_account_id uuid not null references public.timefit_user_management_accounts(id) on delete cascade,
  category_id uuid not null references public.timefit_user_staff_categories(id) on delete cascade,
  primary key (management_account_id, category_id)
);

alter table public.timefit_user_work_schedules
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending','approved','rejected')),
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_comment text;

create index if not exists timefit_schedule_approval_queue
  on public.timefit_user_work_schedules(organization_id, approval_status, work_date);

create or replace function public.timefit_user_is_organization_owner(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.timefit_user_organizations where id=p_organization_id and owner_id=auth.uid());
$$;

create or replace function public.timefit_user_has_management_permission(p_organization_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.timefit_user_management_accounts a
    join public.timefit_user_management_permissions p on p.management_account_id=a.id
    where a.organization_id=p_organization_id and a.user_id=auth.uid() and a.status='active'
      and p.permission_code=p_permission and p.allowed
  );
$$;

create or replace function public.timefit_user_management_can_access_staff(p_organization_id uuid, p_staff_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.timefit_user_management_accounts a
    join public.timefit_user_staff s on s.id=p_staff_id and s.organization_id=p_organization_id
    where a.organization_id=p_organization_id and a.user_id=auth.uid() and a.status='active'
      and (not exists(select 1 from public.timefit_user_management_scopes x where x.management_account_id=a.id)
        or exists(select 1 from public.timefit_user_management_scopes x where x.management_account_id=a.id and x.category_id=s.category_id))
  );
$$;

create or replace function public.timefit_user_prepare_schedule_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.timefit_user_is_organization_owner(new.organization_id) then
    new.approval_status := 'approved'; new.reviewed_by := auth.uid(); new.reviewed_at := now();
  elsif public.timefit_user_has_management_permission(new.organization_id,'schedule.manage') then
    new.approval_status := 'pending'; new.submitted_by := auth.uid(); new.submitted_at := now();
    new.reviewed_by := null; new.reviewed_at := null; new.review_comment := null;
  end if;
  return new;
end $$;

drop trigger if exists timefit_user_schedule_approval_guard on public.timefit_user_work_schedules;
create trigger timefit_user_schedule_approval_guard before insert or update of staff_id,work_date,starts_at,ends_at,break_minutes,shift_name,is_day_off
on public.timefit_user_work_schedules for each row execute procedure public.timefit_user_prepare_schedule_approval();

create or replace function public.timefit_user_review_schedule(p_schedule_id uuid, p_decision text, p_comment text default null)
returns public.timefit_user_work_schedules language plpgsql security definer set search_path=public as $$
declare v_row public.timefit_user_work_schedules;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_schedule_decision'; end if;
  select * into v_row from public.timefit_user_work_schedules where id=p_schedule_id for update;
  if v_row.id is null then raise exception 'schedule_not_found'; end if;
  if not public.timefit_user_is_organization_owner(v_row.organization_id) then raise exception 'organization_owner_required'; end if;
  update public.timefit_user_work_schedules set approval_status=p_decision, reviewed_by=auth.uid(), reviewed_at=now(), review_comment=nullif(trim(p_comment),'') where id=p_schedule_id returning * into v_row;
  return v_row;
end $$;

alter table public.timefit_user_management_accounts enable row level security;
alter table public.timefit_user_management_permissions enable row level security;
alter table public.timefit_user_management_scopes enable row level security;
create policy "management accounts owner or self read" on public.timefit_user_management_accounts for select using (user_id=auth.uid() or public.timefit_user_is_organization_owner(organization_id));
create policy "management permissions owner or self read" on public.timefit_user_management_permissions for select using (exists(select 1 from public.timefit_user_management_accounts a where a.id=management_account_id and (a.user_id=auth.uid() or public.timefit_user_is_organization_owner(a.organization_id))));
create policy "management scopes owner or self read" on public.timefit_user_management_scopes for select using (exists(select 1 from public.timefit_user_management_accounts a where a.id=management_account_id and (a.user_id=auth.uid() or public.timefit_user_is_organization_owner(a.organization_id))));

create policy "delegated staff scoped read" on public.timefit_user_staff for select using (public.timefit_user_has_management_permission(organization_id,'employee.view') and public.timefit_user_management_can_access_staff(organization_id,id));
create policy "delegated schedule scoped read" on public.timefit_user_work_schedules for select using (public.timefit_user_has_management_permission(organization_id,'schedule.view') and public.timefit_user_management_can_access_staff(organization_id,staff_id));
create policy "delegated schedule scoped insert" on public.timefit_user_work_schedules for insert with check (public.timefit_user_has_management_permission(organization_id,'schedule.manage') and public.timefit_user_management_can_access_staff(organization_id,staff_id));
create policy "delegated schedule scoped update" on public.timefit_user_work_schedules for update using (public.timefit_user_has_management_permission(organization_id,'schedule.manage') and public.timefit_user_management_can_access_staff(organization_id,staff_id)) with check (public.timefit_user_has_management_permission(organization_id,'schedule.manage') and public.timefit_user_management_can_access_staff(organization_id,staff_id));
create policy "delegated categories read" on public.timefit_user_staff_categories for select using (public.timefit_user_has_management_permission(organization_id,'schedule.view') or public.timefit_user_has_management_permission(organization_id,'employee.view'));

grant select on public.timefit_user_management_accounts,public.timefit_user_management_permissions,public.timefit_user_management_scopes to authenticated;
grant all on public.timefit_user_management_accounts,public.timefit_user_management_permissions,public.timefit_user_management_scopes to service_role;
grant execute on function public.timefit_user_review_schedule(uuid,text,text) to authenticated;
