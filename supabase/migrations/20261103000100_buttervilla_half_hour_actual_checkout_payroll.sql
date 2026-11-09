-- Butter Villa Gangneung only: start at the later of actual check-in and
-- scheduled start, include work through actual checkout, then deduct existing
-- unpaid breaks and round to the nearest 30 minutes (15 minutes rounds up).
-- Other workplaces retain their existing rounding and scheduled-end cap.
alter table public.timefit_user_organization_settings
  add column if not exists payroll_include_after_scheduled_end boolean not null default false;

insert into public.timefit_user_organization_settings (
  organization_id, workplace_name, payroll_include_after_scheduled_end,
  payroll_rounding_enabled, attendance_rounding_minutes, attendance_rounding_mode
)
select id, name, true, true, 30, 'nearest'
from public.timefit_user_organizations
where trim(name) = '버터빌라 강릉'
on conflict (organization_id) do update
set payroll_include_after_scheduled_end = excluded.payroll_include_after_scheduled_end,
    payroll_rounding_enabled = excluded.payroll_rounding_enabled,
    attendance_rounding_minutes = excluded.attendance_rounding_minutes,
    attendance_rounding_mode = excluded.attendance_rounding_mode,
    updated_at = now();

select pg_notify('pgrst', 'reload schema');
