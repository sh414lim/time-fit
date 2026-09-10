alter table public.timefit_user_staff add column if not exists phone_last8 char(8) check (phone_last8 ~ '^[0-9]{8}$');
alter table public.timefit_user_leave_requests add column if not exists source text not null default 'employee_app' check (source in ('employee_app','tablet'));
create table if not exists public.timefit_user_notification_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  leave_request_id uuid not null references public.timefit_user_leave_requests(id) on delete cascade,
  recipient_staff_id uuid references public.timefit_user_staff(id) on delete set null,
  channel text not null default 'alimtalk', status text not null default 'queued' check (status in ('queued','sent','failed','disabled')),
  provider_message_id text, error_message text, created_at timestamptz not null default now(), sent_at timestamptz
);
alter table public.timefit_user_notification_logs enable row level security;
create policy "manager reads notification logs" on public.timefit_user_notification_logs for select using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select,insert,update on public.timefit_user_notification_logs to authenticated, service_role;
select pg_notify('pgrst','reload schema');
