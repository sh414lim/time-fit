-- Workforce data bound to the existing timefit_user identity and organization model.
create type public.timefit_user_pay_type as enum ('hourly', 'monthly', 'daily');
create type public.timefit_user_schedule_status as enum ('draft', 'published', 'cancelled');
create type public.timefit_user_leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.timefit_user_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  department text,
  job_title text,
  pay_type public.timefit_user_pay_type not null default 'hourly',
  hourly_wage numeric(14,2),
  monthly_salary numeric(14,2),
  joined_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.timefit_user_work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  work_date date not null,
  starts_at time,
  ends_at time,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  shift_name text,
  is_day_off boolean not null default false,
  status public.timefit_user_schedule_status not null default 'published',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, work_date),
  check ((is_day_off and starts_at is null and ends_at is null) or (not is_day_off and starts_at < ends_at))
);

create table public.timefit_user_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  leave_type text not null default '연차',
  amount numeric(5,2) not null check (amount > 0),
  reason text,
  status public.timefit_user_leave_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on <= ends_on)
);

create table public.timefit_user_attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  work_date date not null,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, work_date)
);

create trigger timefit_user_staff_updated_at before update on public.timefit_user_staff for each row execute procedure public.set_updated_at();
create trigger timefit_user_schedule_updated_at before update on public.timefit_user_work_schedules for each row execute procedure public.set_updated_at();
create trigger timefit_user_leave_updated_at before update on public.timefit_user_leave_requests for each row execute procedure public.set_updated_at();
create trigger timefit_user_attendance_updated_at before update on public.timefit_user_attendance_records for each row execute procedure public.set_updated_at();

create or replace function public.timefit_user_is_member(p_organization_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.timefit_user_memberships where organization_id = p_organization_id and user_id = auth.uid());
$$;
create or replace function public.timefit_user_current_staff_id(p_organization_id uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.timefit_user_staff where organization_id = p_organization_id and user_id = auth.uid() limit 1;
$$;

alter table public.timefit_user_staff enable row level security;
alter table public.timefit_user_work_schedules enable row level security;
alter table public.timefit_user_leave_requests enable row level security;
alter table public.timefit_user_attendance_records enable row level security;

create policy "timefit staff member read" on public.timefit_user_staff for select using (public.timefit_user_is_member(organization_id));
create policy "timefit manager staff manage" on public.timefit_user_staff for all using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "timefit schedule member read" on public.timefit_user_work_schedules for select using (public.timefit_user_is_member(organization_id));
create policy "timefit manager schedule manage" on public.timefit_user_work_schedules for all using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "timefit leave owner or manager read" on public.timefit_user_leave_requests for select using (staff_id = public.timefit_user_current_staff_id(organization_id) or public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "timefit employee leave create" on public.timefit_user_leave_requests for insert with check (staff_id = public.timefit_user_current_staff_id(organization_id));
create policy "timefit manager leave review" on public.timefit_user_leave_requests for update using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "timefit attendance member read" on public.timefit_user_attendance_records for select using (public.timefit_user_is_member(organization_id));
create policy "timefit attendance self create" on public.timefit_user_attendance_records for insert with check (staff_id = public.timefit_user_current_staff_id(organization_id));
create policy "timefit attendance self update" on public.timefit_user_attendance_records for update using (staff_id = public.timefit_user_current_staff_id(organization_id));

-- Backfill current managers and accepted employees, then keep it in sync with invitation acceptance.
insert into public.timefit_user_staff (organization_id, user_id, department, job_title, pay_type)
select m.organization_id, m.user_id, i.department, coalesce(i.job_title, case when m.role = 'manager' then '관리자' else '직원' end), 'hourly'
from public.timefit_user_memberships m
left join public.timefit_user_invitations i on i.organization_id = m.organization_id and i.target_user_id = m.user_id and i.status = 'accepted'
on conflict (organization_id, user_id) do nothing;

create or replace function public.timefit_user_accept_invitation(p_invitation_id uuid) returns public.timefit_user_memberships language plpgsql security definer set search_path = public as $$
declare v_invitation public.timefit_user_invitations; v_membership public.timefit_user_memberships;
begin
  select * into v_invitation from public.timefit_user_invitations where id = p_invitation_id and target_user_id = auth.uid() and status = 'pending' for update;
  if v_invitation.id is null then raise exception 'invitation_not_found'; end if;
  insert into public.timefit_user_memberships (organization_id, user_id, role) values (v_invitation.organization_id, auth.uid(), 'employee') returning * into v_membership;
  insert into public.timefit_user_staff (organization_id, user_id, department, job_title) values (v_invitation.organization_id, auth.uid(), v_invitation.department, coalesce(v_invitation.job_title, '직원')) on conflict (organization_id, user_id) do update set department = excluded.department, job_title = excluded.job_title;
  update public.timefit_user_invitations set status = 'accepted', accepted_at = now(), updated_at = now() where id = v_invitation.id;
  return v_membership;
end;
$$;

grant select, insert, update, delete on public.timefit_user_staff, public.timefit_user_work_schedules, public.timefit_user_leave_requests, public.timefit_user_attendance_records to authenticated;
grant execute on function public.timefit_user_is_member(uuid), public.timefit_user_current_staff_id(uuid) to authenticated;
select pg_notify('pgrst', 'reload schema');
