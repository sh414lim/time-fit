-- Daily-worker attendance storage.
--
-- Privacy boundary:
-- * The database never receives a plaintext resident registration number.
-- * The application service encrypts the resident number and creates keyed
--   HMAC values before calling the service-role-only RPCs below.
-- * Public tablet clients only keep a revocable device token.

alter table public.timefit_user_staff
  add column if not exists worker_type text not null default 'regular',
  add column if not exists phone_hmac text,
  add column if not exists last_attended_on date;

alter table public.timefit_user_staff
  drop constraint if exists timefit_user_staff_worker_type_check;
alter table public.timefit_user_staff
  add constraint timefit_user_staff_worker_type_check
  check (worker_type in ('regular', 'daily'));

create index if not exists timefit_daily_worker_organization_idx
  on public.timefit_user_staff(organization_id, last_attended_on desc, display_name)
  where worker_type = 'daily';
create index if not exists timefit_daily_worker_phone_hmac_idx
  on public.timefit_user_staff(organization_id, phone_hmac)
  where worker_type = 'daily' and phone_hmac is not null;

comment on column public.timefit_user_staff.worker_type is
  'regular: account/manual employee, daily: accountless daily worker';
comment on column public.timefit_user_staff.phone_hmac is
  'Server-generated keyed HMAC of the normalized phone number; never a plain digest';

-- Keep resident identity data outside the ordinary staff relation. Existing
-- rows are backfilled with their staff organization before NOT NULL is set.
alter table public.timefit_user_staff_sensitive_profiles
  add column if not exists organization_id uuid references public.timefit_user_organizations(id) on delete cascade,
  add column if not exists resident_registration_hmac text,
  add column if not exists privacy_consented_at timestamptz,
  add column if not exists privacy_policy_version text;

update public.timefit_user_staff_sensitive_profiles sensitive
set organization_id = staff.organization_id
from public.timefit_user_staff staff
where staff.id = sensitive.staff_id
  and sensitive.organization_id is null;

alter table public.timefit_user_staff_sensitive_profiles
  alter column organization_id set not null;

create unique index if not exists timefit_daily_worker_resident_identity_unique
  on public.timefit_user_staff_sensitive_profiles(organization_id, resident_registration_hmac)
  where resident_registration_hmac is not null;

comment on column public.timefit_user_staff_sensitive_profiles.resident_registration_hmac is
  'Server-generated keyed HMAC used only for same-organization identity matching';

alter table public.timefit_user_attendance_records
  add column if not exists check_in_device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  add column if not exists check_out_device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  add column if not exists identity_method text;

create index if not exists timefit_daily_worker_attendance_lookup_idx
  on public.timefit_user_attendance_records(organization_id, work_date desc, staff_id);

comment on column public.timefit_user_attendance_records.identity_method is
  'Identity verification path, for example daily_worker_identity or manager_correction';

create table if not exists public.timefit_user_daily_worker_privacy_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  policy_version text not null check (char_length(trim(policy_version)) between 1 and 80),
  purpose text not null default 'daily_worker_attendance'
    check (purpose = 'daily_worker_attendance'),
  data_categories text[] not null default array['name', 'phone', 'resident_registration_number']::text[],
  consented_via_device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  consented_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (withdrawn_at is null or withdrawn_at >= consented_at)
);

create index if not exists timefit_daily_worker_privacy_consent_staff_idx
  on public.timefit_user_daily_worker_privacy_consents(staff_id, consented_at desc);
create unique index if not exists timefit_daily_worker_privacy_consent_version_unique
  on public.timefit_user_daily_worker_privacy_consents(staff_id, policy_version)
  where withdrawn_at is null;

create table if not exists public.timefit_user_daily_worker_attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  attendance_record_id uuid not null references public.timefit_user_attendance_records(id) on delete cascade,
  device_id uuid references public.timefit_user_tablet_devices(id) on delete set null,
  event_type text not null check (event_type in ('check_in', 'check_out', 'review_required')),
  request_key uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, request_key)
);

create index if not exists timefit_daily_worker_attendance_event_record_idx
  on public.timefit_user_daily_worker_attendance_events(attendance_record_id, occurred_at);

alter table public.timefit_user_daily_worker_privacy_consents enable row level security;
alter table public.timefit_user_daily_worker_attendance_events enable row level security;

drop policy if exists "manager reads daily worker privacy consents"
  on public.timefit_user_daily_worker_privacy_consents;
create policy "manager reads daily worker privacy consents"
  on public.timefit_user_daily_worker_privacy_consents
  for select to authenticated
  using (
    public.timefit_user_is_organization_owner(organization_id)
    or public.timefit_user_has_membership_role(
      organization_id,
      array['manager']::public.timefit_user_role[]
    )
    or public.timefit_user_has_management_permission(organization_id, 'employee.view')
  );

drop policy if exists "manager reads daily worker attendance events"
  on public.timefit_user_daily_worker_attendance_events;
create policy "manager reads daily worker attendance events"
  on public.timefit_user_daily_worker_attendance_events
  for select to authenticated
  using (
    public.timefit_user_is_organization_owner(organization_id)
    or public.timefit_user_has_membership_role(
      organization_id,
      array['manager']::public.timefit_user_role[]
    )
    or public.timefit_user_has_management_permission(organization_id, 'attendance.view')
  );

revoke all on public.timefit_user_daily_worker_privacy_consents from anon, authenticated;
revoke all on public.timefit_user_daily_worker_attendance_events from anon, authenticated;
grant select on public.timefit_user_daily_worker_privacy_consents to authenticated;
grant select on public.timefit_user_daily_worker_attendance_events to authenticated;
grant all on public.timefit_user_daily_worker_privacy_consents to service_role;
grant all on public.timefit_user_daily_worker_attendance_events to service_role;

create or replace function public.timefit_user_validate_attendance_device_organization()
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

drop trigger if exists timefit_user_attendance_device_organization_check
  on public.timefit_user_attendance_records;
create trigger timefit_user_attendance_device_organization_check
before insert or update of organization_id, check_in_device_id, check_out_device_id
on public.timefit_user_attendance_records
for each row execute procedure public.timefit_user_validate_attendance_device_organization();

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
  v_staff public.timefit_user_staff;
  v_record public.timefit_user_attendance_records;
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
    where settings.organization_id = v_device.organization_id
      and settings.tablet_enabled
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

  select staff.* into v_staff
  from public.timefit_user_staff staff
  join public.timefit_user_staff_sensitive_profiles sensitive
    on sensitive.staff_id = staff.id
  where staff.organization_id = v_device.organization_id
    and staff.worker_type = 'daily'
    and sensitive.resident_registration_hmac = p_resident_hmac
  limit 1
  for update of staff;

  if v_staff.id is null then
    insert into public.timefit_user_staff(
      organization_id, user_id, display_name, department, job_title,
      pay_type, joined_on, phone_e164, phone_last4, phone_last8,
      registration_type, worker_type, phone_hmac, last_attended_on
    ) values (
      v_device.organization_id, null, trim(p_name), '일용직', '일용직',
      'daily', v_today, p_phone_e164, p_phone_last4, p_phone_last8,
      'manual', 'daily', p_phone_hmac, v_today
    ) returning * into v_staff;

    insert into public.timefit_user_staff_sensitive_profiles(
      staff_id, organization_id, resident_registration_mask,
      encrypted_resident_registration_number, resident_registration_hmac,
      privacy_consented_at, privacy_policy_version, updated_by
    ) values (
      v_staff.id, v_device.organization_id, p_resident_mask,
      p_resident_ciphertext, p_resident_hmac,
      v_now, trim(p_policy_version), v_device.activated_by
    );
    v_is_new := true;
  else
    if v_staff.phone_hmac is distinct from p_phone_hmac
      or trim(v_staff.display_name) is distinct from trim(p_name)
    then
      raise exception using errcode = '22023', message = 'daily_worker_identity_conflict';
    end if;
    update public.timefit_user_staff_sensitive_profiles
    set privacy_consented_at = v_now,
        privacy_policy_version = trim(p_policy_version),
        updated_by = v_device.activated_by
    where staff_id = v_staff.id
      and privacy_policy_version is distinct from trim(p_policy_version);
  end if;

  insert into public.timefit_user_daily_worker_privacy_consents(
    organization_id, staff_id, policy_version, consented_via_device_id, consented_at
  ) values (
    v_device.organization_id, v_staff.id, trim(p_policy_version), v_device.id, v_now
  ) on conflict (staff_id, policy_version) where withdrawn_at is null do nothing;

  select * into v_record
  from public.timefit_user_attendance_records attendance
  where attendance.staff_id = v_staff.id
    and attendance.check_in_request_key = p_request_key
  limit 1;
  if v_record.id is not null then
    return jsonb_build_object(
      'action', 'check_in', 'duplicate', true, 'staffId', v_staff.id,
      'employeeName', v_staff.display_name, 'workDate', v_record.work_date,
      'checkedInAt', v_record.checked_in_at, 'checkedOutAt', v_record.checked_out_at,
      'timezone', v_timezone, 'requestId', p_request_key
    );
  end if;

  select * into v_record
  from public.timefit_user_attendance_records attendance
  where attendance.staff_id = v_staff.id
    and attendance.work_date = v_today
  for update;
  if v_record.id is not null then
    raise exception using errcode = '23505', message = 'daily_worker_already_checked_in';
  end if;

  insert into public.timefit_user_attendance_records(
    organization_id, staff_id, work_date, checked_in_at, source,
    check_in_request_key, status, needs_review, check_in_device_id, identity_method
  ) values (
    v_device.organization_id, v_staff.id, v_today, v_now, 'daily_worker_tablet',
    p_request_key, 'working', false, v_device.id, 'daily_worker_identity'
  ) returning * into v_record;

  insert into public.timefit_user_daily_worker_attendance_events(
    organization_id, staff_id, attendance_record_id, device_id,
    event_type, request_key, occurred_at, metadata
  ) values (
    v_device.organization_id, v_staff.id, v_record.id, v_device.id,
    'check_in', p_request_key, v_now, jsonb_build_object('newWorker', v_is_new)
  );

  update public.timefit_user_staff
  set last_attended_on = greatest(coalesce(last_attended_on, v_today), v_today)
  where id = v_staff.id;
  update public.timefit_user_tablet_devices set last_used_at = v_now where id = v_device.id;

  return jsonb_build_object(
    'action', 'check_in', 'duplicate', false, 'newWorker', v_is_new,
    'staffId', v_staff.id, 'employeeName', v_staff.display_name,
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
  v_staff public.timefit_user_staff;
  v_record public.timefit_user_attendance_records;
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
    where settings.organization_id = v_device.organization_id
      and settings.tablet_enabled
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
  select count(*) into v_candidate_count
  from public.timefit_user_staff staff
  where staff.organization_id = v_device.organization_id
    and staff.worker_type = 'daily'
    and staff.phone_hmac = p_phone_hmac;
  if v_candidate_count = 0 then
    raise exception using errcode = 'P0002', message = 'daily_worker_open_attendance_not_found';
  end if;
  if v_candidate_count > 1 then
    raise exception using errcode = '21000', message = 'daily_worker_additional_verification_required';
  end if;

  select * into v_staff
  from public.timefit_user_staff staff
  where staff.organization_id = v_device.organization_id
    and staff.worker_type = 'daily'
    and staff.phone_hmac = p_phone_hmac
  limit 1
  for update;

  select * into v_record
  from public.timefit_user_attendance_records attendance
  where attendance.staff_id = v_staff.id
    and attendance.check_out_request_key = p_request_key
  limit 1;
  if v_record.id is not null then
    return jsonb_build_object(
      'action', case when v_record.needs_review then 'review_required' else 'check_out' end,
      'duplicate', true, 'staffId', v_staff.id,
      'employeeName', v_staff.display_name, 'workDate', v_record.work_date,
      'checkedInAt', v_record.checked_in_at, 'checkedOutAt', v_record.checked_out_at,
      'timezone', v_timezone, 'requestId', p_request_key
    );
  end if;

  select * into v_record
  from public.timefit_user_attendance_records attendance
  where attendance.staff_id = v_staff.id
    and attendance.checked_in_at is not null
    and attendance.checked_out_at is null
  order by attendance.checked_in_at desc
  limit 1
  for update;

  if v_record.id is null then
    if exists (
      select 1 from public.timefit_user_attendance_records attendance
      where attendance.staff_id = v_staff.id
        and attendance.work_date = (v_now at time zone v_timezone)::date
        and attendance.checked_out_at is not null
    ) then
      raise exception using errcode = '23505', message = 'daily_worker_already_checked_out';
    end if;
    raise exception using errcode = 'P0002', message = 'daily_worker_open_attendance_not_found';
  end if;

  if v_now - v_record.checked_in_at > interval '18 hours' then
    update public.timefit_user_attendance_records
    set needs_review = true,
        check_out_request_key = p_request_key,
        check_out_device_id = v_device.id,
        identity_method = 'daily_worker_identity',
        source = 'daily_worker_tablet'
    where id = v_record.id
    returning * into v_record;
    insert into public.timefit_user_daily_worker_attendance_events(
      organization_id, staff_id, attendance_record_id, device_id,
      event_type, request_key, occurred_at
    ) values (
      v_device.organization_id, v_staff.id, v_record.id, v_device.id,
      'review_required', p_request_key, v_now
    );
    return jsonb_build_object(
      'action', 'review_required', 'duplicate', false, 'staffId', v_staff.id,
      'employeeName', v_staff.display_name, 'workDate', v_record.work_date,
      'checkedInAt', v_record.checked_in_at, 'checkedOutAt', null,
      'timezone', v_timezone, 'requestId', p_request_key
    );
  end if;

  update public.timefit_user_attendance_records
  set checked_out_at = v_now,
      source = 'daily_worker_tablet',
      check_out_request_key = p_request_key,
      check_out_device_id = v_device.id,
      identity_method = 'daily_worker_identity'
  where id = v_record.id
  returning * into v_record;

  insert into public.timefit_user_daily_worker_attendance_events(
    organization_id, staff_id, attendance_record_id, device_id,
    event_type, request_key, occurred_at
  ) values (
    v_device.organization_id, v_staff.id, v_record.id, v_device.id,
    'check_out', p_request_key, v_now
  );

  update public.timefit_user_staff
  set last_attended_on = greatest(coalesce(last_attended_on, v_record.work_date), v_record.work_date)
  where id = v_staff.id;
  update public.timefit_user_tablet_devices set last_used_at = v_now where id = v_device.id;

  return jsonb_build_object(
    'action', 'check_out', 'duplicate', false, 'staffId', v_staff.id,
    'employeeName', v_staff.display_name, 'workDate', v_record.work_date,
    'checkedInAt', v_record.checked_in_at, 'checkedOutAt', v_record.checked_out_at,
    'timezone', v_timezone, 'requestId', p_request_key
  );
end;
$$;

-- Only trusted application services may submit pre-encrypted identity values.
-- Tablet browsers call a server endpoint, never these functions directly.
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

create or replace view public.timefit_user_daily_worker_attendance
with (security_invoker = true)
as
select
  attendance.id,
  attendance.organization_id,
  attendance.staff_id,
  staff.display_name,
  case
    when staff.phone_last4 is null then null
    else '***-****-' || staff.phone_last4
  end as phone_mask,
  attendance.work_date,
  attendance.checked_in_at,
  attendance.checked_out_at,
  attendance.status,
  attendance.needs_review,
  attendance.source,
  attendance.check_in_device_id,
  attendance.check_out_device_id,
  attendance.updated_at
from public.timefit_user_attendance_records attendance
join public.timefit_user_staff staff on staff.id = attendance.staff_id
where staff.worker_type = 'daily';

grant select on public.timefit_user_daily_worker_attendance to authenticated;

select pg_notify('pgrst', 'reload schema');
