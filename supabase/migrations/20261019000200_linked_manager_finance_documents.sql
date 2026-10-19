-- Linked employee managers use their existing app identity. Grant document
-- access from the same explicit finance permissions used by the web and PWA.

drop policy if exists "delegated managers read finance documents"
  on public.timefit_user_finance_documents;
create policy "delegated managers read finance documents"
  on public.timefit_user_finance_documents
  for select
  using (
    (
      public.timefit_user_has_management_permission(organization_id, 'finance.view')
      or public.timefit_user_has_management_permission(organization_id, 'expense.manage')
      or public.timefit_user_has_management_permission(organization_id, 'expense.receipt.review')
    )
    and public.timefit_user_management_can_access_cost_center(
      organization_id,
      cost_center_id
    )
  );

drop policy if exists "delegated managers insert drive receipts"
  on public.timefit_user_finance_documents;
create policy "delegated managers insert drive receipts"
  on public.timefit_user_finance_documents
  for insert
  with check (
    document_type = 'receipt'
    and uploaded_by = auth.uid()
    and public.timefit_user_has_management_permission(
      organization_id,
      'expense.manage'
    )
    and public.timefit_user_management_can_access_cost_center(
      organization_id,
      cost_center_id
    )
  );

select pg_notify('pgrst', 'reload schema');
