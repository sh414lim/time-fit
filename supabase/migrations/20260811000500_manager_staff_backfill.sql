-- Every manager needs a staff row too: tablet notifications and attendance
-- workflows resolve people through timefit_user_staff.
insert into public.timefit_user_staff (organization_id, user_id, job_title)
select m.organization_id, m.user_id, '관리자'
from public.timefit_user_memberships m
where m.role = 'manager'
on conflict (organization_id, user_id) do nothing;

create or replace function public.timefit_user_bootstrap_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
begin
  if not exists (
    select 1 from public.timefit_user_accounts
    where id = auth.uid() and role = 'manager'
  ) then
    raise exception 'manager_role_required';
  end if;

  select organization_id into v_organization_id
  from public.timefit_user_memberships
  where user_id = auth.uid()
  limit 1;

  if v_organization_id is not null then
    return v_organization_id;
  end if;

  insert into public.timefit_user_organizations (name, owner_id)
  values (nullif(trim(p_name), ''), auth.uid())
  returning id into v_organization_id;

  insert into public.timefit_user_memberships (organization_id, user_id, role)
  values (v_organization_id, auth.uid(), 'manager');

  insert into public.timefit_user_staff (organization_id, user_id, job_title)
  values (v_organization_id, auth.uid(), '관리자')
  on conflict (organization_id, user_id) do nothing;

  return v_organization_id;
end;
$$;

grant execute on function public.timefit_user_bootstrap_organization(text) to authenticated;
select pg_notify('pgrst', 'reload schema');
