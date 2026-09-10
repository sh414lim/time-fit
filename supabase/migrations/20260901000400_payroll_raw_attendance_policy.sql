-- Allow each workplace to calculate hourly payroll from raw attendance time.
alter table public.timefit_user_organization_settings
  add column if not exists payroll_deduct_break_enabled boolean not null default true,
  add column if not exists payroll_rounding_enabled boolean not null default true;

update public.timefit_user_organization_settings
set payroll_deduct_break_enabled = false,
    payroll_rounding_enabled = false,
    updated_at = now()
where organization_id = '7df7b797-2e2a-4e99-b3e4-ef88c443ff31';

select pg_notify('pgrst', 'reload schema');
