-- Isolated TimeFit identity, roles, business onboarding and invitations.
create type public.timefit_user_role as enum ('manager', 'employee');
create type public.timefit_user_invitation_status as enum ('pending', 'accepted', 'cancelled');

create table public.timefit_user_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.timefit_user_role not null default 'employee',
  display_name text not null,
  employee_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.timefit_user_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.timefit_user_memberships (
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.timefit_user_role not null,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.timefit_user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  employee_code text not null,
  department text,
  job_title text,
  status public.timefit_user_invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, target_user_id)
);

create index timefit_user_invitations_target on public.timefit_user_invitations(target_user_id, status);
create trigger timefit_user_accounts_updated_at before update on public.timefit_user_accounts for each row execute procedure public.set_updated_at();
create trigger timefit_user_organizations_updated_at before update on public.timefit_user_organizations for each row execute procedure public.set_updated_at();
create trigger timefit_user_invitations_updated_at before update on public.timefit_user_invitations for each row execute procedure public.set_updated_at();

create or replace function public.handle_timefit_user_account() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.timefit_user_accounts (id, role, display_name)
  values (new.id, case when new.raw_user_meta_data->>'role' = 'manager' then 'manager'::public.timefit_user_role else 'employee'::public.timefit_user_role end, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$;
create trigger on_auth_user_created_timefit_user after insert on auth.users for each row execute procedure public.handle_timefit_user_account();

create or replace function public.timefit_user_has_membership_role(p_organization_id uuid, p_roles public.timefit_user_role[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.timefit_user_memberships where organization_id = p_organization_id and user_id = auth.uid() and role = any(p_roles));
$$;

create or replace function public.timefit_user_bootstrap_organization(p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare v_organization_id uuid;
begin
  if not exists(select 1 from public.timefit_user_accounts where id = auth.uid() and role = 'manager') then raise exception 'manager_role_required'; end if;
  select organization_id into v_organization_id from public.timefit_user_memberships where user_id = auth.uid() limit 1;
  if v_organization_id is not null then return v_organization_id; end if;
  insert into public.timefit_user_organizations (name, owner_id) values (nullif(trim(p_name), ''), auth.uid()) returning id into v_organization_id;
  insert into public.timefit_user_memberships (organization_id, user_id, role) values (v_organization_id, auth.uid(), 'manager');
  return v_organization_id;
end;
$$;

create or replace function public.timefit_user_create_invitation(p_organization_id uuid, p_employee_code text, p_department text default null, p_job_title text default null)
returns public.timefit_user_invitations language plpgsql security definer set search_path = public as $$
declare v_account public.timefit_user_accounts; v_invitation public.timefit_user_invitations;
begin
  if not public.timefit_user_has_membership_role(p_organization_id, array['manager']::public.timefit_user_role[]) then raise exception 'manager_role_required'; end if;
  select * into v_account from public.timefit_user_accounts where employee_code = upper(trim(p_employee_code)) and role = 'employee';
  if v_account.id is null then raise exception 'employee_code_not_found'; end if;
  insert into public.timefit_user_invitations (organization_id, target_user_id, employee_code, department, job_title, invited_by)
  values (p_organization_id, v_account.id, v_account.employee_code, nullif(trim(p_department), ''), nullif(trim(p_job_title), ''), auth.uid())
  on conflict (organization_id, target_user_id) do update set status = 'pending', department = excluded.department, job_title = excluded.job_title, invited_by = auth.uid(), updated_at = now()
  returning * into v_invitation;
  return v_invitation;
end;
$$;

create or replace function public.timefit_user_accept_invitation(p_invitation_id uuid) returns public.timefit_user_memberships language plpgsql security definer set search_path = public as $$
declare v_invitation public.timefit_user_invitations; v_membership public.timefit_user_memberships;
begin
  select * into v_invitation from public.timefit_user_invitations where id = p_invitation_id and target_user_id = auth.uid() and status = 'pending' for update;
  if v_invitation.id is null then raise exception 'invitation_not_found'; end if;
  insert into public.timefit_user_memberships (organization_id, user_id, role) values (v_invitation.organization_id, auth.uid(), 'employee') returning * into v_membership;
  update public.timefit_user_invitations set status = 'accepted', accepted_at = now(), updated_at = now() where id = v_invitation.id;
  return v_membership;
end;
$$;

alter table public.timefit_user_accounts enable row level security;
alter table public.timefit_user_organizations enable row level security;
alter table public.timefit_user_memberships enable row level security;
alter table public.timefit_user_invitations enable row level security;
create policy "timefit_user account self read" on public.timefit_user_accounts for select using (id = auth.uid());
create policy "timefit_user account self update" on public.timefit_user_accounts for update using (id = auth.uid()) with check (id = auth.uid());
create policy "timefit_user organization member read" on public.timefit_user_organizations for select using (exists(select 1 from public.timefit_user_memberships m where m.organization_id = id and m.user_id = auth.uid()));
create policy "timefit_user membership own read" on public.timefit_user_memberships for select using (user_id = auth.uid() or public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "timefit_user invitation recipient read" on public.timefit_user_invitations for select using (target_user_id = auth.uid() or public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
grant execute on function public.timefit_user_bootstrap_organization(text) to authenticated;
grant execute on function public.timefit_user_create_invitation(uuid, text, text, text) to authenticated;
grant execute on function public.timefit_user_accept_invitation(uuid) to authenticated;
