alter table public.timefit_user_short_term_workers
  add column if not exists encrypted_phone_number text;

comment on column public.timefit_user_short_term_workers.encrypted_phone_number is
  'Application-encrypted full phone number for authorized manager display';

select pg_notify('pgrst', 'reload schema');
