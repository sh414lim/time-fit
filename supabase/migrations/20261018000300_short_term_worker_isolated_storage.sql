-- Short-term workers are not registered as ordinary staff.
-- Their identity, consent, and attendance live in dedicated tables so they do
-- not appear in employee management, payroll contracts, or regular schedules.

create table if not exists public.timefit_user_short_term_workers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 30),
  phone_hmac text not null check (phone_hmac ~ '^[0-9a-f]{64}$'),
  phone_last4 text not null check (phone_last4 ~ '^[0-9]{4}$'),
  phone_last8 text not null check (phone_last8 ~ '^[0-9]{8}$'),
  encrypted_resident_registration_number text not null,
  resident_registration_mask text not null check (char_length(resident_registration_mask) = 14),
  resident_registration_hmac text not null check (resident_registration_hmac ~ '^[0-9a-f]{64}$'),
  privacy_policy_version text not null,
  privacy_consented_at timestamptz not null,
  last_attended_on date,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, resident_registration_hmac)
);

create index if not exists timefit_short_term_worker_phone_idx
  on public.timefit_user_short_term_workers(organization_id, phone_hmac);
create index if not exists timefit_short_term_worker_recent_idx
  on public.timefit_user_short_term_workers(organization_id, last_attended_on desc, display_name);

comment on table public.timefit_user_short_term_workers is
  'Accountless short-term worker identities, isolated from ordinary staff registration';
comment on column public.timefit_user_short_term_workers.encrypted_resident_registration_number is
  'Application-encrypted resident number; plaintext never reaches PostgreSQL';
comment on column public.timefit_user_short_term_workers.resident_registration_hmac is
  'Keyed HMAC for same-organization identity matching';

create table if not exists public.timefit_user_short_term_attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  short_term_worker_id uuid not null references public.timefit_user_short_term_workers(id) on delete cascade,
  work_date date not null,
  checked_in_at timestamptz not null,
  checked_out_at timestamptz,
  status text not null default 'working' check (status in ('working', 'completed', 'review_required')),
  needs_review boolean not null default false,
  source text not null default 'short_term_worker_tablet',
  identity_method text not null default 'resident_and_phone',
  check_in_request_key uuid not null,
  check_out_request_key uuid,
  check_in_device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  check_out_device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (short_term_worker_id, work_date),
  unique (organization_id, check_in_request_key),
  unique (organization_id, check_out_request_key),
  check (checked_out_at is null or checked_out_at >= checked_in_at)
);

create index if not exists timefit_short_term_attendance_org_date_idx
  on public.timefit_user_short_term_attendance_records(organization_id, work_date desc);
create index if not exists timefit_short_term_attendance_open_idx
  on public.timefit_user_short_term_attendance_records(organization_id, short_term_worker_id, checked_in_at desc)
  where checked_out_at is null;

create table if not exists public.timefit_user_short_term_privacy_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  short_term_worker_id uuid not null references public.timefit_user_short_term_workers(id) on delete cascade,
  policy_version text not null,
  data_categories text[] not null default array['name', 'phone', 'resident_registration_number']::text[],
  consented_via_device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  consented_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (withdrawn_at is null or withdrawn_at >= consented_at)
);

create unique index if not exists timefit_short_term_consent_version_unique
  on public.timefit_user_short_term_privacy_consents(short_term_worker_id, policy_version)
  where withdrawn_at is null;

create table if not exists public.timefit_user_short_term_attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  short_term_worker_id uuid not null references public.timefit_user_short_term_workers(id) on delete cascade,
  attendance_record_id uuid not null references public.timefit_user_short_term_attendance_records(id) on delete cascade,
  device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  event_type text not null check (event_type in ('check_in', 'check_out', 'review_required')),
  request_key uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, request_key)
);

alter table public.timefit_user_short_term_workers enable row level security;
alter table public.timefit_user_short_term_attendance_records enable row level security;
alter table public.timefit_user_short_term_privacy_consents enable row level security;
alter table public.timefit_user_short_term_attendance_events enable row level security;

revoke all on public.timefit_user_short_term_workers from anon, authenticated;
revoke all on public.timefit_user_short_term_attendance_records from anon, authenticated;
revoke all on public.timefit_user_short_term_privacy_consents from anon, authenticated;
revoke all on public.timefit_user_short_term_attendance_events from anon, authenticated;
grant all on public.timefit_user_short_term_workers to service_role;
grant all on public.timefit_user_short_term_attendance_records to service_role;
grant all on public.timefit_user_short_term_privacy_consents to service_role;
grant all on public.timefit_user_short_term_attendance_events to service_role;

create or replace function public.timefit_user_validate_short_term_attendance_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.check_in_device_id is not null and not exists (
    select 1 from public.timefit_user_tablet_devices device
    where device.id = new.check_in_device_id
      and device.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'check_in_device_organization_mismatch';
  end if;
  if new.check_out_device_id is not null and not exists (
    select 1 from public.timefit_user_tablet_devices device
    where device.id = new.check_out_device_id
      and device.organization_id = new.organization_id
  ) then
    raise exception using errcode = '23514', message = 'check_out_device_organization_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists timefit_short_term_attendance_device_check
  on public.timefit_user_short_term_attendance_records;
create trigger timefit_short_term_attendance_device_check
before insert or update of organization_id, check_in_device_id, check_out_device_id
on public.timefit_user_short_term_attendance_records
for each row execute procedure public.timefit_user_validate_short_term_attendance_device();

create or replace function public.timefit_user_daily_worker_check_in(
  p_device_token text,
  p_name text,
  p_phone_e164 text,
  p_phone_hmac text,
  p_phone_last4 text,
  p_phone_last8 text,
  p_resident_ciphertext text,
  p_resident_mask text,
  p_resident_hmac text,
  p_policy_version text,
  p_request_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.timefit_user_tablet_devices;
  v_worker public.timefit_user_short_term_workers;
  v_record public.timefit_user_short_term_attendance_records;
  v_timezone text;
  v_today date;
  v_now timestamptz := clock_timestamp();
  v_is_new boolean := false;
begin
  if nullif(trim(p_device_token), '') is null
    or p_request_key is null
    or char_length(trim(coalesce(p_name, ''))) not between 2 and 30
    or p_phone_e164 !~ '^\+82[0-9]{9,10}$'
    or p_phone_last4 !~ '^[0-9]{4}$'
    or p_phone_last8 !~ '^[0-9]{8}$'
    or p_phone_hmac !~ '^[0-9a-f]{64}$'
    or p_resident_hmac !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_resident_ciphertext, '')) not between 20 and 2048
    or char_length(coalesce(p_resident_mask, '')) <> 14
    or char_length(trim(coalesce(p_policy_version, ''))) not between 1 and 80
  then
    raise exception using errcode = '22023', message = 'daily_worker_invalid_payload';
  end if;

  select * into v_device
  from public.timefit_user_tablet_devices device
  where device.token_hash = encode(extensions.digest(trim(p_device_token), 'sha256'), 'hex')
    and device.status = 'active'
    and device.expires_at > v_now
  for update;
  if v_device.id is null then
    raise exception using errcode = '42501', message = 'tablet_device_not_active';
  end if;
  if not exists (
    select 1 from public.timefit_user_organization_settings settings
    where settings.organization_id = v_device.organization_id and settings.tablet_enabled
  ) then
    raise exception using errcode = '42501', message = 'tablet_access_denied';
  end if;

  select coalesce(settings.timezone, 'Asia/Seoul') into v_timezone
  from public.timefit_user_organization_settings settings
  where settings.organization_id = v_device.organization_id;
  v_timezone := coalesce(v_timezone, 'Asia/Seoul');
  v_today := (v_now at time zone v_timezone)::date;

  perform pg_advisory_xact_lock(
    hashtextextended(v_device.organization_id::text || ':' || p_resident_hmac, 18)
  );

  select worker.* into v_worker
  from public.timefit_user_short_term_workers worker
  where worker.organization_id = v_device.organization_id
    and worker.resident_registration_hmac = p_resident_hmac
  limit 1
  for update;

  if v_worker.id is null then
    insert into public.timefit_user_short_term_workers(
      organization_id, display_name, phone_hmac, phone_last4, phone_last8,
      encrypted_resident_registration_number, resident_registration_mask,
      resident_registration_hmac, privacy_policy_version,
      privacy_consented_at, last_attended_on
    ) values (
      v_device.organization_id, trim(p_name), p_phone_hmac, p_phone_last4, p_phone_last8,
      p_resident_ciphertext, p_resident_mask, p_resident_hmac,
      trim(p_policy_version), v_now, v_today
    ) returning * into v_worker;
    v_is_new := true;
  else
    if v_worker.phone_hmac is distinct from p_phone_hmac
      or trim(v_worker.display_name) is distinct from trim(p_name)
    then
      raise exception using errcode = '22023', message = 'daily_worker_identity_conflict';
    end if;
    update public.timefit_user_short_term_workers
    set privacy_consented_at = v_now,
        privacy_policy_version = trim(p_policy_version),
        updated_at = v_now
    where id = v_worker.id;
  end if;

  insert into public.timefit_user_short_term_privacy_consents(
    organization_id, short_term_worker_id, policy_version,
    consented_via_device_id, consented_at
  ) values (
    v_device.organization_id, v_worker.id, trim(p_policy_version), v_device.id, v_now
  ) on conflict (short_term_worker_id, policy_version) where withdrawn_at is null do nothing;

  select attendance.* into v_record
  from public.timefit_user_short_term_attendance_records attendance
  where attendance.organization_id = v_device.organization_id
    and attendance.check_in_request_key = p_request_key
    and attendance.short_term_worker_id = v_worker.id
  limit 1;
  if v_record.id is not null then
    return jsonb_build_object(
      'action', 'check_in', 'duplicate', true, 'workerId', v_worker.id,
      'employeeName', v_worker.display_name, 'workDate', v_record.work_date,
      'checkedInAt', v_record.checked_in_at, 'checkedOutAt', v_record.checked_out_at,
      'timezone', v_timezone, 'requestId', p_request_key
    );
  end if;

  select attendance.* into v_record
  from public.timefit_user_short_term_attendance_records attendance
  where attendance.short_term_worker_id = v_worker.id
    and attendance.work_date = v_today
  for update;
  if v_record.id is not null then
    raise exception using errcode = '23505', message = 'daily_worker_already_checked_in';
  end if;

  insert into public.timefit_user_short_term_attendance_records(
    organization_id, short_term_worker_id, work_date, checked_in_at,
    check_in_request_key, check_in_device_id
  ) values (
    v_device.organization_id, v_worker.id, v_today, v_now,
    p_request_key, v_device.id
  ) returning * into v_record;

  insert into public.timefit_user_short_term_attendance_events(
    organization_id, short_term_worker_id, attendance_record_id, device_id,
    event_type, request_key, occurred_at, metadata
  ) values (
    v_device.organization_id, v_worker.id, v_record.id, v_device.id,
    'check_in', p_request_key, v_now, jsonb_build_object('newWorker', v_is_new)
  );

  update public.timefit_user_short_term_workers
  set last_attended_on = greatest(coalesce(last_attended_on, v_today), v_today),
      updated_at = v_now
  where id = v_worker.id;
  update public.timefit_user_tablet_devices set last_used_at = v_now where id = v_device.id;

  return jsonb_build_object(
    'action', 'check_in', 'duplicate', false, 'newWorker', v_is_new,
    'workerId', v_worker.id, 'employeeName', v_worker.display_name,
    'workDate', v_today, 'checkedInAt', v_record.checked_in_at,
    'checkedOutAt', null, 'timezone', v_timezone, 'requestId', p_request_key
  );
end;
$$;

create or replace function public.timefit_user_daily_worker_check_out(
  p_device_token text,
  p_phone_hmac text,
  p_request_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.timefit_user_tablet_devices;
  v_worker public.timefit_user_short_term_workers;
  v_record public.timefit_user_short_term_attendance_records;
  v_timezone text;
  v_now timestamptz := clock_timestamp();
  v_candidate_count integer;
begin
  if nullif(trim(p_device_token), '') is null
    or p_request_key is null
    or p_phone_hmac !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'daily_worker_invalid_payload';
  end if;

  select * into v_device
  from public.timefit_user_tablet_devices device
  where device.token_hash = encode(extensions.digest(trim(p_device_token), 'sha256'), 'hex')
    and device.status = 'active'
    and device.expires_at > v_now
  for update;
  if v_device.id is null then
    raise exception using errcode = '42501', message = 'tablet_device_not_active';
  end if;
  if not exists (
    select 1 from public.timefit_user_organization_settings settings
    where settings.organization_id = v_device.organization_id and settings.tablet_enabled
  ) then
    raise exception using errcode = '42501', message = 'tablet_access_denied';
  end if;

  select coalesce(settings.timezone, 'Asia/Seoul') into v_timezone
  from public.timefit_user_organization_settings settings
  where settings.organization_id = v_device.organization_id;
  v_timezone := coalesce(v_timezone, 'Asia/Seoul');

  perform pg_advisory_xact_lock(
    hashtextextended(v_device.organization_id::text || ':' || p_phone_hmac, 19)
  );

  select attendance.* into v_record
  from public.timefit_user_short_term_attendance_records attendance
  join public.timefit_user_short_term_workers worker
    on worker.id = attendance.short_term_worker_id
  where attendance.organization_id = v_device.organization_id
    and attendance.check_out_request_key = p_request_key
    and worker.phone_hmac = p_phone_hmac
  limit 1;
  if v_record.id is not null then
    select * into v_worker from public.timefit_user_short_term_workers
    where id = v_record.short_term_worker_id;
    return jsonb_build_object(
      'action', case when v_record.needs_review then 'review_required' else 'check_out' end,
      'duplicate', true, 'workerId', v_worker.id,
      'employeeName', v_worker.display_name, 'workDate', v_record.work_date,
      'checkedInAt', v_record.checked_in_at, 'checkedOutAt', v_record.checked_out_at,
      'timezone', v_timezone, 'requestId', p_request_key
    );
  end if;

  select count(*) into v_candidate_count
  from public.timefit_user_short_term_attendance_records attendance
  join public.timefit_user_short_term_workers worker
    on worker.id = attendance.short_term_worker_id
  where attendance.organization_id = v_device.organization_id
    and worker.phone_hmac = p_phone_hmac
    and attendance.checked_out_at is null;
  if v_candidate_count > 1 then
    raise exception using errcode = '21000', message = 'daily_worker_additional_verification_required';
  end if;

  select attendance.* into v_record
  from public.timefit_user_short_term_attendance_records attendance
  join public.timefit_user_short_term_workers worker
    on worker.id = attendance.short_term_worker_id
  where attendance.organization_id = v_device.organization_id
    and worker.phone_hmac = p_phone_hmac
    and attendance.checked_out_at is null
  order by attendance.checked_in_at desc
  limit 1
  for update of attendance;

  if v_record.id is null then
    if exists (
      select 1
      from public.timefit_user_short_term_attendance_records attendance
      join public.timefit_user_short_term_workers worker
        on worker.id = attendance.short_term_worker_id
      where attendance.organization_id = v_device.organization_id
        and worker.phone_hmac = p_phone_hmac
        and attendance.work_date = (v_now at time zone v_timezone)::date
        and attendance.checked_out_at is not null
    ) then
      raise exception using errcode = '23505', message = 'daily_worker_already_checked_out';
    end if;
    raise exception using errcode = 'P0002', message = 'daily_worker_open_attendance_not_found';
  end if;

  select * into v_worker from public.timefit_user_short_term_workers
  where id = v_record.short_term_worker_id
  for update;

  if v_now - v_record.checked_in_at > interval '18 hours' then
    update public.timefit_user_short_term_attendance_records
    set needs_review = true,
        status = 'review_required',
        check_out_request_key = p_request_key,
        check_out_device_id = v_device.id,
        updated_at = v_now
    where id = v_record.id
    returning * into v_record;
    insert into public.timefit_user_short_term_attendance_events(
      organization_id, short_term_worker_id, attendance_record_id, device_id,
      event_type, request_key, occurred_at
    ) values (
      v_device.organization_id, v_worker.id, v_record.id, v_device.id,
      'review_required', p_request_key, v_now
    );
    return jsonb_build_object(
      'action', 'review_required', 'duplicate', false, 'workerId', v_worker.id,
      'employeeName', v_worker.display_name, 'workDate', v_record.work_date,
      'checkedInAt', v_record.checked_in_at, 'checkedOutAt', null,
      'timezone', v_timezone, 'requestId', p_request_key
    );
  end if;

  update public.timefit_user_short_term_attendance_records
  set checked_out_at = v_now,
      status = 'completed',
      check_out_request_key = p_request_key,
      check_out_device_id = v_device.id,
      updated_at = v_now
  where id = v_record.id
  returning * into v_record;

  insert into public.timefit_user_short_term_attendance_events(
    organization_id, short_term_worker_id, attendance_record_id, device_id,
    event_type, request_key, occurred_at
  ) values (
    v_device.organization_id, v_worker.id, v_record.id, v_device.id,
    'check_out', p_request_key, v_now
  );

  update public.timefit_user_short_term_workers
  set last_attended_on = greatest(coalesce(last_attended_on, v_record.work_date), v_record.work_date),
      updated_at = v_now
  where id = v_worker.id;
  update public.timefit_user_tablet_devices set last_used_at = v_now where id = v_device.id;

  return jsonb_build_object(
    'action', 'check_out', 'duplicate', false, 'workerId', v_worker.id,
    'employeeName', v_worker.display_name, 'workDate', v_record.work_date,
    'checkedInAt', v_record.checked_in_at, 'checkedOutAt', v_record.checked_out_at,
    'timezone', v_timezone, 'requestId', p_request_key
  );
end;
$$;

revoke all on function public.timefit_user_daily_worker_check_in(
  text, text, text, text, text, text, text, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.timefit_user_daily_worker_check_out(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.timefit_user_daily_worker_check_in(
  text, text, text, text, text, text, text, text, text, text, uuid
) to service_role;
grant execute on function public.timefit_user_daily_worker_check_out(text, text, uuid)
  to service_role;

create or replace view public.timefit_user_short_term_attendance
as
select
  attendance.id,
  attendance.organization_id,
  attendance.short_term_worker_id,
  worker.display_name,
  '***-****-' || worker.phone_last4 as phone_mask,
  attendance.work_date,
  attendance.checked_in_at,
  attendance.checked_out_at,
  attendance.status,
  attendance.needs_review,
  attendance.check_in_device_id,
  attendance.check_out_device_id,
  attendance.updated_at
from public.timefit_user_short_term_attendance_records attendance
join public.timefit_user_short_term_workers worker
  on worker.id = attendance.short_term_worker_id
where public.timefit_user_is_organization_owner(attendance.organization_id)
   or public.timefit_user_has_membership_role(
     attendance.organization_id,
     array['manager']::public.timefit_user_role[]
   )
   or public.timefit_user_has_management_permission(attendance.organization_id, 'attendance.view');

revoke all on public.timefit_user_short_term_attendance from anon;
grant select on public.timefit_user_short_term_attendance to authenticated;

select pg_notify('pgrst', 'reload schema');
