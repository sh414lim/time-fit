-- TimeFit authentication onboarding and employee invitation flow
alter table public.profiles
  add column if not exists employee_code text unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

update public.profiles
set employee_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where employee_code is null;

alter table public.profiles alter column employee_code set not null;

create type public.employee_invitation_status as enum ('pending', 'accepted', 'cancelled', 'expired');

create table public.employee_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  employee_code text not null,
  department text,
  job_title text,
  employment_type public.employment_type not null default 'hourly',
  status public.employee_invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, target_user_id)
);
create index employee_invitations_target_status on public.employee_invitations(target_user_id, status);
create trigger employee_invitations_updated_at before update on public.employee_invitations for each row execute procedure public.set_updated_at();

create or replace function public.create_employee_invitation(
  p_organization_id uuid,
  p_employee_code text,
  p_workplace_id uuid default null,
  p_department text default null,
  p_job_title text default null,
  p_employment_type public.employment_type default 'hourly'
) returns public.employee_invitations language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles; v_invitation public.employee_invitations;
begin
  if not public.has_organization_role(p_organization_id, array['owner','admin','manager']::public.member_role[]) then raise exception 'not_authorized'; end if;
  select * into v_profile from public.profiles where employee_code = upper(trim(p_employee_code));
  if v_profile.id is null then raise exception 'employee_code_not_found'; end if;
  if exists(select 1 from public.organization_members where organization_id = p_organization_id and user_id = v_profile.id) then raise exception 'already_organization_member'; end if;
  insert into public.employee_invitations (organization_id, workplace_id, target_user_id, employee_code, department, job_title, employment_type, invited_by)
  values (p_organization_id, p_workplace_id, v_profile.id, v_profile.employee_code, nullif(trim(p_department), ''), nullif(trim(p_job_title), ''), p_employment_type, auth.uid())
  on conflict (organization_id, target_user_id) do update set workplace_id = excluded.workplace_id, department = excluded.department, job_title = excluded.job_title, employment_type = excluded.employment_type, status = 'pending', invited_by = auth.uid(), updated_at = now()
  returning * into v_invitation;
  return v_invitation;
end;
$$;

create or replace function public.accept_employee_invitation(p_invitation_id uuid)
returns public.employees language plpgsql security definer set search_path = public as $$
declare v_invite public.employee_invitations; v_profile public.profiles; v_employee public.employees;
begin
  select * into v_invite from public.employee_invitations where id = p_invitation_id and target_user_id = auth.uid() and status = 'pending' for update;
  if v_invite.id is null then raise exception 'invitation_not_found'; end if;
  select * into v_profile from public.profiles where id = auth.uid();
  insert into public.organization_members (organization_id, user_id, workplace_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.workplace_id, 'employee');
  insert into public.employees (organization_id, workplace_id, user_id, employee_no, name, email, department, job_title, joined_on)
  values (v_invite.organization_id, v_invite.workplace_id, auth.uid(), v_profile.employee_code, v_profile.display_name, (select email from auth.users where id = auth.uid()), v_invite.department, v_invite.job_title, current_date)
  returning * into v_employee;
  insert into public.employment_contracts (employee_id, employment_type, started_on)
  values (v_employee.id, v_invite.employment_type, current_date);
  update public.employee_invitations set status = 'accepted', accepted_at = now(), updated_at = now() where id = v_invite.id;
  return v_employee;
end;
$$;

alter table public.employee_invitations enable row level security;
create policy "manager manages employee invitations" on public.employee_invitations for all using (public.has_organization_role(organization_id, array['owner','admin','manager']::public.member_role[]));
create policy "employee reads own invitations" on public.employee_invitations for select using (target_user_id = auth.uid());
grant execute on function public.create_employee_invitation(uuid, text, uuid, text, text, public.employment_type) to authenticated;
grant execute on function public.accept_employee_invitation(uuid) to authenticated;
