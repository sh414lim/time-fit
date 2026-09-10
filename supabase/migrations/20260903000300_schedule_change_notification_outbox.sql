-- Queue approved schedule changes for the notification delivery worker.
-- This migration is intentionally provider-neutral: email, Kakao and push workers
-- can consume the same payload without making schedule writes wait on a vendor API.
create table if not exists public.timefit_user_schedule_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  schedule_id uuid not null references public.timefit_user_work_schedules(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('schedule_approved','schedule_changed')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (schedule_id, event_type, created_at)
);

create index if not exists timefit_schedule_notification_pending
  on public.timefit_user_schedule_notification_outbox(status, available_at, created_at);

create or replace function public.timefit_user_enqueue_schedule_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_recipient uuid;
  v_event text;
begin
  if new.approval_status <> 'approved' then return new; end if;
  if tg_op = 'UPDATE' and old.approval_status = 'approved'
    and (old.work_date, old.starts_at, old.ends_at, old.break_minutes, old.shift_name, old.is_day_off)
      is not distinct from
        (new.work_date, new.starts_at, new.ends_at, new.break_minutes, new.shift_name, new.is_day_off)
  then return new; end if;

  select user_id into v_recipient from public.timefit_user_staff where id=new.staff_id;
  if v_recipient is null then return new; end if;
  v_event := case when tg_op='INSERT' or (tg_op='UPDATE' and old.approval_status <> 'approved')
    then 'schedule_approved' else 'schedule_changed' end;

  insert into public.timefit_user_schedule_notification_outbox(
    organization_id, schedule_id, staff_id, recipient_user_id, event_type, payload
  ) values (
    new.organization_id, new.id, new.staff_id, v_recipient, v_event,
    jsonb_build_object(
      'workDate', new.work_date,
      'startsAt', new.starts_at,
      'endsAt', new.ends_at,
      'breakMinutes', new.break_minutes,
      'shiftName', new.shift_name,
      'isDayOff', new.is_day_off
    )
  );
  return new;
end $$;

drop trigger if exists timefit_user_schedule_notification_enqueue on public.timefit_user_work_schedules;
create trigger timefit_user_schedule_notification_enqueue
after insert or update on public.timefit_user_work_schedules
for each row execute procedure public.timefit_user_enqueue_schedule_notification();

alter table public.timefit_user_schedule_notification_outbox enable row level security;
create policy "schedule notifications owner read" on public.timefit_user_schedule_notification_outbox
for select using (public.timefit_user_is_organization_owner(organization_id));
create policy "schedule notifications recipient read" on public.timefit_user_schedule_notification_outbox
for select using (recipient_user_id=auth.uid());

grant select on public.timefit_user_schedule_notification_outbox to authenticated;
grant all on public.timefit_user_schedule_notification_outbox to service_role;
