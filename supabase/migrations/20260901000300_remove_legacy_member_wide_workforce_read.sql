-- Old workforce migrations left member-wide SELECT policies in parallel with
-- the later privacy policies. PostgreSQL ORs permissive policies, which would
-- otherwise let delegated employee-memberships see the whole workplace.
drop policy if exists "timefit staff member read" on public.timefit_user_staff;
drop policy if exists "timefit schedule member read" on public.timefit_user_work_schedules;
drop policy if exists "timefit attendance member read" on public.timefit_user_attendance_records;

-- Delegated attendance access is explicitly scoped, just like staff/schedule.
create policy "delegated attendance scoped read" on public.timefit_user_attendance_records
for select using (
  public.timefit_user_has_management_permission(organization_id,'attendance.view')
  and public.timefit_user_management_can_access_staff(organization_id,staff_id)
);

select pg_notify('pgrst','reload schema');
