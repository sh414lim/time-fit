-- Receipt OCR state and immutable processing history.
alter table public.timefit_user_finance_documents
  add column if not exists processing_status text not null default 'not_requested'
    check (processing_status in ('not_requested','queued','processing','review_required','matched','failed')),
  add column if not exists extracted_data jsonb,
  add column if not exists ocr_text text,
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

alter table public.timefit_user_finance_documents
  drop constraint if exists timefit_user_finance_documents_document_type_check;
alter table public.timefit_user_finance_documents
  add constraint timefit_user_finance_documents_document_type_check
  check (document_type in ('receipt','tax_invoice','sales_slip','other'));

create table if not exists public.timefit_user_expense_processing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  document_id uuid not null references public.timefit_user_finance_documents(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','processing','succeeded','failed')),
  ocr_provider text not null default 'google_vision',
  ocr_model text,
  extractor_version text not null,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists timefit_expense_processing_document_idx
  on public.timefit_user_expense_processing_runs(document_id, created_at desc);

alter table public.timefit_user_expense_processing_runs enable row level security;
create policy "manager reads receipt processing runs" on public.timefit_user_expense_processing_runs
  for select using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select on public.timefit_user_expense_processing_runs to authenticated;

-- Extend the existing private finance bucket for camera and gallery receipts.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf','text/csv','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg','image/png','image/webp','image/heic','image/heif'
]
where id = 'timefit-finance-documents';

select pg_notify('pgrst','reload schema');
