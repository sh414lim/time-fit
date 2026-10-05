-- Repair an environment where the lifecycle migration version was recorded
-- before its staff columns were added to the live schema.
alter table public.timefit_user_staff
  add column if not exists employment_status text not null default 'active'
    check (employment_status in ('active', 'terminated')),
  add column if not exists terminated_on date,
  add column if not exists termination_reason text;

create index if not exists timefit_user_staff_employment_status_idx
  on public.timefit_user_staff(organization_id, employment_status, sort_order, created_at);

create or replace function public.timefit_user_current_staff_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.timefit_user_staff
  where organization_id = p_organization_id
    and user_id = auth.uid()
    and employment_status = 'active'
  limit 1;
$$;

select pg_notify('pgrst', 'reload schema');
