-- Existing TimeFit businesses identify their primary administrator with the
-- manager membership. Delegated accounts remain employee memberships, so this
-- safely keeps legacy managers as super administrators.
create or replace function public.timefit_user_is_organization_owner(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.timefit_user_organizations where id=p_organization_id and owner_id=auth.uid())
    or exists(select 1 from public.timefit_user_memberships where organization_id=p_organization_id and user_id=auth.uid() and role='manager');
$$;
