alter table public.timefit_user_staff add column if not exists registration_type text not null default 'linked' check (registration_type in ('manual','linked'));
alter table public.timefit_user_invitations add column if not exists staff_id uuid references public.timefit_user_staff(id) on delete set null;

create or replace function public.timefit_user_invite_manual_staff(p_staff_id uuid, p_employee_code text)
returns public.timefit_user_invitations language plpgsql security definer set search_path=public as $$
declare v_staff public.timefit_user_staff; v_account public.timefit_user_accounts; v_invitation public.timefit_user_invitations;
begin
  select * into v_staff from public.timefit_user_staff where id=p_staff_id;
  if v_staff.id is null or not public.timefit_user_has_membership_role(v_staff.organization_id,array['manager']::public.timefit_user_role[]) then raise exception 'manager_role_required'; end if;
  if v_staff.user_id is not null then raise exception 'staff_already_linked'; end if;
  select * into v_account from public.timefit_user_accounts where employee_code=upper(trim(p_employee_code)) and role='employee';
  if v_account.id is null then raise exception 'employee_code_not_found'; end if;
  insert into public.timefit_user_invitations(organization_id,target_user_id,employee_code,department,job_title,staff_id,invited_by)
  values(v_staff.organization_id,v_account.id,v_account.employee_code,v_staff.department,v_staff.job_title,v_staff.id,auth.uid())
  on conflict(organization_id,target_user_id) do update set status='pending',staff_id=excluded.staff_id,department=excluded.department,job_title=excluded.job_title,invited_by=auth.uid(),updated_at=now()
  returning * into v_invitation;
  return v_invitation;
end $$;

create or replace function public.timefit_user_accept_invitation(p_invitation_id uuid) returns public.timefit_user_memberships language plpgsql security definer set search_path=public as $$
declare v_invitation public.timefit_user_invitations; v_membership public.timefit_user_memberships;
begin
  select * into v_invitation from public.timefit_user_invitations where id=p_invitation_id and target_user_id=auth.uid() and status='pending' for update;
  if v_invitation.id is null then raise exception 'invitation_not_found'; end if;
  insert into public.timefit_user_memberships(organization_id,user_id,role) values(v_invitation.organization_id,auth.uid(),'employee') returning * into v_membership;
  if v_invitation.staff_id is not null then
    update public.timefit_user_staff set user_id=auth.uid(),registration_type='linked',department=coalesce(v_invitation.department,department),job_title=coalesce(v_invitation.job_title,job_title),updated_at=now() where id=v_invitation.staff_id;
  else
    insert into public.timefit_user_staff(organization_id,user_id,display_name,department,job_title,registration_type) values(v_invitation.organization_id,auth.uid(),null,v_invitation.department,coalesce(v_invitation.job_title,'직원'),'linked') on conflict(organization_id,user_id) do update set department=excluded.department,job_title=excluded.job_title;
  end if;
  update public.timefit_user_invitations set status='accepted',accepted_at=now(),updated_at=now() where id=v_invitation.id;
  return v_membership;
end $$;
grant execute on function public.timefit_user_invite_manual_staff(uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');
