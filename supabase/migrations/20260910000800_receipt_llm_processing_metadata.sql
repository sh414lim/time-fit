alter table public.timefit_user_expense_processing_runs
  add column if not exists extraction_provider text,
  add column if not exists extraction_model text,
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists fallback_used boolean not null default false;

select pg_notify('pgrst','reload schema');
