-- Employees may read only their own staff, schedule and attendance rows.
-- Managers retain business-wide operational access.
drop policy if exists "workforce staff read" on public.timefit_user_staff;
create policy "workforce staff self or manager read" on public.timefit_user_staff
  for select using (
    user_id = auth.uid()
    or public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[])
  );

drop policy if exists "workforce schedule read" on public.timefit_user_work_schedules;
create policy "workforce schedule self or manager read" on public.timefit_user_work_schedules
  for select using (
    staff_id = public.timefit_user_current_staff_id(organization_id)
    or public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[])
  );

drop policy if exists "workforce attendance read" on public.timefit_user_attendance_records;
create policy "workforce attendance self or manager read" on public.timefit_user_attendance_records
  for select using (
    staff_id = public.timefit_user_current_staff_id(organization_id)
    or public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[])
  );

-- Tablet PIN and internal operational settings must not be readable by employees.
drop policy if exists "member reads timefit settings" on public.timefit_user_organization_settings;
create policy "manager reads timefit settings" on public.timefit_user_organization_settings
  for select using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));

select pg_notify('pgrst', 'reload schema');
