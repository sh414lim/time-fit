-- Preserve employment history while allowing managers to offboard staff safely.
-- Existing delegated managers who can already view staff receive the matching
-- management permission so the employee-add and lifecycle controls are usable.
insert into public.timefit_user_management_permissions(management_account_id, permission_code, allowed)
select permission.management_account_id, 'employee.manage', true
from public.timefit_user_management_permissions permission
join public.timefit_user_management_accounts account on account.id = permission.management_account_id
where permission.permission_code = 'employee.view'
  and permission.allowed = true
  and account.status = 'active'
on conflict (management_account_id, permission_code)
do update set allowed = true;

alter table public.timefit_user_staff
  add column if not exists employment_status text not null default 'active'
    check (employment_status in ('active', 'terminated')),
  add column if not exists terminated_on date,
  add column if not exists termination_reason text;

create index if not exists timefit_user_staff_employment_status_idx
  on public.timefit_user_staff(organization_id, employment_status, sort_order, created_at);

-- A terminated person must no longer be resolved as the signed-in employee,
-- even when the same user still has a separate management account.
create or replace function public.timefit_user_current_staff_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.timefit_user_staff
  where organization_id = p_organization_id
    and user_id = auth.uid()
    and employment_status = 'active'
  limit 1;
$$;

create table if not exists public.timefit_user_staff_lifecycle_audits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null,
  action text not null check (action in ('terminate', 'reactivate', 'delete')),
  staff_snapshot jsonb not null,
  reason text not null,
  performed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.timefit_user_staff_lifecycle_audits enable row level security;
create policy "staff lifecycle audit owner or delegated read"
  on public.timefit_user_staff_lifecycle_audits for select
  using (
    public.timefit_user_is_organization_owner(organization_id)
    or public.timefit_user_has_management_permission(organization_id, 'employee.manage')
  );
grant select on public.timefit_user_staff_lifecycle_audits to authenticated;

create or replace function public.timefit_user_manage_staff_lifecycle(
  p_organization_id uuid,
  p_staff_id uuid,
  p_action text,
  p_effective_on date default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff public.timefit_user_staff;
  v_snapshot jsonb;
  v_is_owner boolean;
  v_is_delegated boolean;
  v_has_references boolean := false;
  v_reference record;
  v_count bigint;
begin
  if p_action not in ('terminate', 'reactivate', 'delete') then raise exception 'invalid_staff_lifecycle_action'; end if;
  if length(trim(coalesce(p_reason, ''))) < 2 or length(p_reason) > 500 then raise exception 'staff_lifecycle_reason_required'; end if;

  v_is_owner := public.timefit_user_is_organization_owner(p_organization_id);
  v_is_delegated := public.timefit_user_has_management_permission(p_organization_id, 'employee.manage');
  if not (v_is_owner or v_is_delegated) then raise exception 'employee_manage_required'; end if;

  select * into v_staff from public.timefit_user_staff
  where id = p_staff_id and organization_id = p_organization_id for update;
  if v_staff.id is null then raise exception 'staff_not_found'; end if;
  if v_is_delegated and not v_is_owner
     and not public.timefit_user_management_can_access_staff(p_organization_id, p_staff_id) then
    raise exception 'staff_scope_denied';
  end if;
  v_snapshot := to_jsonb(v_staff);

  if p_action = 'terminate' then
    if coalesce(p_effective_on, (now() at time zone 'Asia/Seoul')::date) > (now() at time zone 'Asia/Seoul')::date then raise exception 'future_termination_not_allowed'; end if;
    update public.timefit_user_staff
      set employment_status = 'terminated', terminated_on = coalesce(p_effective_on, (now() at time zone 'Asia/Seoul')::date),
          termination_reason = trim(p_reason), updated_at = now()
      where id = p_staff_id;
    -- Employee memberships are removed so an existing session can no longer load workplace data.
    if v_staff.user_id is not null and not exists (
      select 1 from public.timefit_user_management_accounts a
      where a.organization_id = p_organization_id and a.user_id = v_staff.user_id and a.status = 'active'
    ) then
      delete from public.timefit_user_memberships
      where organization_id = p_organization_id and user_id = v_staff.user_id and role = 'employee';
    end if;
  elsif p_action = 'reactivate' then
    update public.timefit_user_staff
      set employment_status = 'active', terminated_on = null, termination_reason = null, updated_at = now()
      where id = p_staff_id;
    if v_staff.user_id is not null then
      insert into public.timefit_user_memberships(organization_id, user_id, role)
      values(p_organization_id, v_staff.user_id, 'employee')
      on conflict (organization_id, user_id) do nothing;
    end if;
  else
    if not v_is_owner then raise exception 'staff_delete_owner_only'; end if;
    if v_staff.user_id is not null or v_staff.registration_type <> 'manual' then raise exception 'linked_staff_cannot_delete'; end if;
    -- Refuse deletion when any table still references this staff row, including future tables.
    for v_reference in
      select n.nspname as schema_name, c.relname as table_name, a.attname as column_name
      from pg_constraint fk
      join pg_class c on c.oid = fk.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join unnest(fk.conkey) with ordinality key(attnum, ord) on true
      join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = key.attnum
      where fk.contype = 'f' and fk.confrelid = 'public.timefit_user_staff'::regclass
        and c.relname not in (
          'timefit_user_payroll_contracts',
          'timefit_user_staff_sensitive_profiles',
          'timefit_user_staff_order_preferences'
        )
    loop
      execute format('select count(*) from %I.%I where %I = $1', v_reference.schema_name, v_reference.table_name, v_reference.column_name)
        into v_count using p_staff_id;
      if v_count > 0 then v_has_references := true; exit; end if;
    end loop;
    if v_has_references then raise exception 'staff_has_work_history'; end if;
    delete from public.timefit_user_staff where id = p_staff_id;
  end if;

  insert into public.timefit_user_staff_lifecycle_audits(
    organization_id, staff_id, action, staff_snapshot, reason, performed_by
  ) values (p_organization_id, p_staff_id, p_action, v_snapshot, trim(p_reason), auth.uid());

  return jsonb_build_object('staffId', p_staff_id, 'action', p_action, 'effectiveOn', p_effective_on);
end;
$$;

revoke all on function public.timefit_user_manage_staff_lifecycle(uuid,uuid,text,date,text) from public, anon;
grant execute on function public.timefit_user_manage_staff_lifecycle(uuid,uuid,text,date,text) to authenticated;

select pg_notify('pgrst', 'reload schema');
