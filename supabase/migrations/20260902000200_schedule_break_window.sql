alter table public.timefit_user_work_schedules
  add column if not exists break_starts_at time,
  add column if not exists break_ends_at time;

alter table public.timefit_user_work_schedules
  drop constraint if exists timefit_user_work_schedules_break_window_check;

alter table public.timefit_user_work_schedules
  add constraint timefit_user_work_schedules_break_window_check check (
    (break_starts_at is null and break_ends_at is null)
    or (not is_day_off and break_starts_at is not null and break_ends_at is not null
      and starts_at <= break_starts_at and break_starts_at < break_ends_at and break_ends_at <= ends_at)
  );
