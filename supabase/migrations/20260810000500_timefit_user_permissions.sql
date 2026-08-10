-- Grant the API roles access; RLS policies continue to limit authenticated users.
grant usage on schema public to authenticated, service_role;
grant select, update on public.timefit_user_accounts to authenticated;
grant select on public.timefit_user_organizations, public.timefit_user_memberships, public.timefit_user_invitations to authenticated;
grant all privileges on public.timefit_user_accounts, public.timefit_user_organizations, public.timefit_user_memberships, public.timefit_user_invitations to service_role;
select pg_notify('pgrst', 'reload schema');
