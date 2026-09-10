-- Per-workplace shift types used by manager schedule registration.
alter table public.timefit_user_organization_settings
  add column if not exists shift_types text[] not null
  default array['일반 근무', '오픈 근무', '마감 근무', '오전 근무', '오후 근무', '휴무']::text[];

update public.timefit_user_organization_settings
set shift_types = array['일반 근무', '오픈 근무', '마감 근무', '오전 근무', '오후 근무', '휴무']::text[]
where shift_types is null or cardinality(shift_types) = 0;

select pg_notify('pgrst', 'reload schema');
