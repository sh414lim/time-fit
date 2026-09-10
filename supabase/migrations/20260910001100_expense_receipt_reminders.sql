-- Receipt reminders use a dedicated outbox because their recipients and
-- cadence differ from attendance alerts.
alter table public.timefit_user_organization_settings
  add column if not exists receipt_reminder_enabled boolean not null default true,
  add column if not exists receipt_reminder_first_after_days integer not null default 3,
  add column if not exists receipt_reminder_repeat_days integer not null default 3,
  add column if not exists receipt_reminder_max_count integer not null default 3;

alter table public.timefit_user_organization_settings
  drop constraint if exists timefit_receipt_reminder_first_after_days_check,
  add constraint timefit_receipt_reminder_first_after_days_check check (receipt_reminder_first_after_days between 1 and 30),
  drop constraint if exists timefit_receipt_reminder_repeat_days_check,
  add constraint timefit_receipt_reminder_repeat_days_check check (receipt_reminder_repeat_days between 1 and 30),
  drop constraint if exists timefit_receipt_reminder_max_count_check,
  add constraint timefit_receipt_reminder_max_count_check check (receipt_reminder_max_count between 1 and 10);

create table if not exists public.timefit_user_expense_receipt_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  transaction_group_id uuid not null references public.timefit_user_card_transaction_groups(id) on delete cascade,
  corporate_card_id uuid not null references public.timefit_user_corporate_cards(id) on delete restrict,
  staff_id uuid references public.timefit_user_staff(id) on delete set null,
  reminder_number integer not null check (reminder_number between 1 and 10),
  channel text not null default 'in_app' check (channel in ('in_app','email','kakao')),
  status text not null default 'sent' check (status in ('queued','sent','read','cancelled','failed')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  read_at timestamptz,
  cancelled_at timestamptz,
  message text not null,
  error_code text,
  created_at timestamptz not null default now(),
  unique (transaction_group_id, reminder_number, channel)
);

create index if not exists timefit_expense_receipt_reminders_org_status_idx
  on public.timefit_user_expense_receipt_reminders(organization_id, status, created_at desc);
create index if not exists timefit_expense_receipt_reminders_staff_idx
  on public.timefit_user_expense_receipt_reminders(staff_id, status, created_at desc)
  where staff_id is not null;

alter table public.timefit_user_expense_receipt_reminders enable row level security;
create policy "manager manages expense receipt reminders"
  on public.timefit_user_expense_receipt_reminders for all
  using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
create policy "staff reads own expense receipt reminders"
  on public.timefit_user_expense_receipt_reminders for select
  using (staff_id = public.timefit_user_current_staff_id(organization_id));

grant select, insert, update, delete on public.timefit_user_expense_receipt_reminders to authenticated;
select pg_notify('pgrst','reload schema');
