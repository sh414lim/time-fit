-- Allow receipt originals to live in Google Drive while keeping existing
-- Supabase Storage documents fully compatible.

alter table public.timefit_user_finance_documents
  alter column storage_path drop not null,
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists external_file_id text,
  add column if not exists external_url text;

alter table public.timefit_user_finance_document_pages
  alter column storage_path drop not null,
  add column if not exists storage_provider text not null default 'supabase',
  add column if not exists external_file_id text,
  add column if not exists external_url text;

alter table public.timefit_user_finance_documents
  drop constraint if exists timefit_finance_documents_storage_provider_check,
  drop constraint if exists timefit_finance_documents_storage_location_check,
  add constraint timefit_finance_documents_storage_provider_check
    check (storage_provider in ('supabase','google_drive')),
  add constraint timefit_finance_documents_storage_location_check
    check (
      (storage_provider = 'supabase' and storage_path is not null)
      or
      (storage_provider = 'google_drive'
        and nullif(trim(external_file_id),'') is not null
        and nullif(trim(external_url),'') is not null)
    );

alter table public.timefit_user_finance_document_pages
  drop constraint if exists timefit_finance_document_pages_storage_provider_check,
  drop constraint if exists timefit_finance_document_pages_storage_location_check,
  add constraint timefit_finance_document_pages_storage_provider_check
    check (storage_provider in ('supabase','google_drive')),
  add constraint timefit_finance_document_pages_storage_location_check
    check (
      (storage_provider = 'supabase' and storage_path is not null)
      or
      (storage_provider = 'google_drive'
        and nullif(trim(external_file_id),'') is not null
        and nullif(trim(external_url),'') is not null)
    );

create unique index if not exists timefit_finance_documents_external_file_unique
  on public.timefit_user_finance_documents(organization_id, storage_provider, external_file_id)
  where external_file_id is not null;

create unique index if not exists timefit_finance_document_pages_external_file_unique
  on public.timefit_user_finance_document_pages(organization_id, storage_provider, external_file_id)
  where external_file_id is not null;

comment on column public.timefit_user_finance_documents.external_file_id is
  'Provider-native file identifier, such as a Google Drive file ID.';
comment on column public.timefit_user_finance_documents.external_url is
  'Provider URL used to open the original file after application authorization.';
comment on column public.timefit_user_finance_document_pages.external_file_id is
  'Provider-native file identifier for this receipt page.';
comment on column public.timefit_user_finance_document_pages.external_url is
  'Provider URL for this receipt page.';

select pg_notify('pgrst','reload schema');
