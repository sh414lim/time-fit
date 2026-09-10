alter table public.timefit_user_finance_documents
  add column if not exists content_sha256 text,
  add column if not exists receipt_fingerprint text,
  add column if not exists duplicate_of_document_id uuid references public.timefit_user_finance_documents(id) on delete set null;

create unique index if not exists timefit_finance_documents_receipt_content_unique
  on public.timefit_user_finance_documents(organization_id, content_sha256)
  where document_type = 'receipt' and content_sha256 is not null;
create index if not exists timefit_finance_documents_receipt_fingerprint_idx
  on public.timefit_user_finance_documents(organization_id, receipt_fingerprint)
  where document_type = 'receipt' and receipt_fingerprint is not null;

select pg_notify('pgrst','reload schema');
