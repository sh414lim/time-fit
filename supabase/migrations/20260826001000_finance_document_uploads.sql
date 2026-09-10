create table if not exists public.timefit_user_finance_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  document_type text not null check (document_type in ('tax_invoice','sales_slip','other')),
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  document_date date,
  memo text,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists timefit_finance_documents_org_created_idx
  on public.timefit_user_finance_documents(organization_id, created_at desc);

alter table public.timefit_user_finance_documents enable row level security;
create policy "manager manages finance documents" on public.timefit_user_finance_documents
  for all using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select, insert, update, delete on public.timefit_user_finance_documents to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('timefit-finance-documents', 'timefit-finance-documents', false, 20971520, array['application/pdf','text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "manager reads finance document files" on storage.objects for select
using (bucket_id = 'timefit-finance-documents' and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid,array['manager']::public.timefit_user_role[]));
create policy "manager uploads finance document files" on storage.objects for insert
with check (bucket_id = 'timefit-finance-documents' and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid,array['manager']::public.timefit_user_role[]));
create policy "manager deletes finance document files" on storage.objects for delete
using (bucket_id = 'timefit-finance-documents' and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid,array['manager']::public.timefit_user_role[]));

select pg_notify('pgrst','reload schema');
