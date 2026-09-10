-- Employee-facing receipt submission and private personal reminder access.
alter table public.timefit_user_finance_documents
  add column if not exists submitted_by_staff_id uuid references public.timefit_user_staff(id) on delete set null,
  add column if not exists submission_reason text;

create index if not exists timefit_finance_documents_staff_created_idx
  on public.timefit_user_finance_documents(submitted_by_staff_id, created_at desc)
  where submitted_by_staff_id is not null;

create policy "staff inserts own receipt documents"
  on public.timefit_user_finance_documents for insert
  with check (
    document_type = 'receipt'
    and uploaded_by = auth.uid()
    and submitted_by_staff_id = public.timefit_user_current_staff_id(organization_id)
  );

create policy "staff reads own receipt documents"
  on public.timefit_user_finance_documents for select
  using (
    document_type = 'receipt'
    and uploaded_by = auth.uid()
    and submitted_by_staff_id = public.timefit_user_current_staff_id(organization_id)
  );

create policy "staff uploads own receipt files"
  on storage.objects for insert
  with check (
    bucket_id = 'timefit-finance-documents'
    and public.timefit_user_is_member((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "staff reads own receipt files"
  on storage.objects for select
  using (
    bucket_id = 'timefit-finance-documents'
    and public.timefit_user_is_member((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

grant select, insert on public.timefit_user_finance_documents to authenticated;

create or replace function public.timefit_user_mark_expense_receipt_reminder_read(p_reminder_id uuid)
returns public.timefit_user_expense_receipt_reminders
language plpgsql
security definer
set search_path = public
as $$
declare v_reminder public.timefit_user_expense_receipt_reminders;
begin
  select * into v_reminder from public.timefit_user_expense_receipt_reminders where id = p_reminder_id for update;
  if v_reminder.id is null then raise exception 'reminder_not_found'; end if;
  if v_reminder.staff_id <> public.timefit_user_current_staff_id(v_reminder.organization_id) then raise exception 'forbidden'; end if;
  update public.timefit_user_expense_receipt_reminders
    set status = 'read', read_at = coalesce(read_at, now())
    where id = p_reminder_id returning * into v_reminder;
  return v_reminder;
end $$;

revoke all on function public.timefit_user_mark_expense_receipt_reminder_read(uuid) from public;
grant execute on function public.timefit_user_mark_expense_receipt_reminder_read(uuid) to authenticated;

create or replace function public.timefit_user_cancel_resolved_receipt_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source_type = 'card_transaction_group' then
    update public.timefit_user_expense_receipt_reminders
      set status = 'cancelled', cancelled_at = now()
      where organization_id = new.organization_id
        and transaction_group_id::text = new.source_id
        and status in ('queued','sent');
  end if;
  return new;
end $$;

drop trigger if exists timefit_cancel_resolved_receipt_reminders on public.timefit_user_expense_sources;
create trigger timefit_cancel_resolved_receipt_reminders
after insert on public.timefit_user_expense_sources
for each row execute procedure public.timefit_user_cancel_resolved_receipt_reminders();

select pg_notify('pgrst','reload schema');
