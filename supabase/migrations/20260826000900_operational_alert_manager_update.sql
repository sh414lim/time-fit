create policy "manager updates operational alerts"
  on public.timefit_user_operational_alerts
  for update
  using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));

select pg_notify('pgrst','reload schema');
