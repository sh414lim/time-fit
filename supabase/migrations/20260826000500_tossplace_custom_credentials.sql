-- Tenant-specific API credentials are encrypted by the Vercel server before
-- storage. They are never selectable as plain text by a browser client.
alter table public.timefit_user_tossplace_connections
  add column if not exists credential_source text not null default 'platform'
    check (credential_source in ('platform','custom')),
  add column if not exists encrypted_access_key text,
  add column if not exists encrypted_access_secret text,
  add column if not exists provider_settings jsonb not null default '{}'::jsonb;

select pg_notify('pgrst', 'reload schema');
