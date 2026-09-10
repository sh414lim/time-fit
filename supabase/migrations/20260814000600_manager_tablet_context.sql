-- Returns a manager-owned organization for one-time tablet activation.
-- Kept server-side so tablet setup never depends on a client-visible membership query.
create or replace function public.timefit_user_get_manager_tablet_organization()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_membership public.timefit_user_memberships;
begin
  select * into v_membership
  from public.timefit_user_memberships
  where user_id = auth.uid() and role = 'manager'
  order by joined_at asc
  limit 1;

  if v_membership is null then
    raise exception 'tablet_manager_required';
  end if;

  return jsonb_build_object('organizationId', v_membership.organization_id);
end $$;

grant execute on function public.timefit_user_get_manager_tablet_organization() to authenticated;
select pg_notify('pgrst', 'reload schema');
