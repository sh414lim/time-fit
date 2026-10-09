-- Allow an activated store tablet to display only its own organization's
-- immutable attendance QR. The device capability is validated on every read.
-- If an older organization has no static QR yet, the first tablet read creates
-- it once; later reads always return the exact same token.

create or replace function public.timefit_user_tablet_static_attendance_qr(
  p_device_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device public.timefit_user_tablet_devices;
  v_settings public.timefit_user_organization_settings;
  v_static public.timefit_user_attendance_static_qr;
  v_session_id uuid;
  v_token text;
  v_name text;
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_device_token), '') is null then
    raise exception using errcode = '22023', message = 'invalid_device_token';
  end if;

  select * into v_device
  from public.timefit_user_tablet_devices
  where token_hash = encode(extensions.digest(trim(p_device_token), 'sha256'), 'hex')
    and status = 'active'
    and expires_at > v_now;
  if v_device.id is null then
    raise exception using errcode = '42501', message = 'tablet_device_not_active';
  end if;

  select * into v_settings
  from public.timefit_user_organization_settings
  where organization_id = v_device.organization_id;
  if v_settings is null or not v_settings.tablet_enabled then
    raise exception using errcode = '42501', message = 'tablet_access_denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_device.organization_id::text, 2));
  select coalesce(nullif(trim(v_settings.workplace_name), ''), organization.name)
    into v_name
  from public.timefit_user_organizations organization
  where organization.id = v_device.organization_id;
  if v_name is null then
    raise exception using errcode = '22023', message = 'organization_not_found';
  end if;

  select * into v_static
  from public.timefit_user_attendance_static_qr
  where organization_id = v_device.organization_id
  for update;

  if v_static.organization_id is null then
    -- Match the manager web's first-time setup behavior. This is the only path
    -- that creates a value; there is intentionally no regenerate parameter.
    update public.timefit_user_attendance_qr_sessions
    set revoked_at = v_now
    where organization_id = v_device.organization_id
      and revoked_at is null;
    update public.timefit_user_mobile_attendance_qr_tokens
    set is_active = false, revoked_at = v_now
    where organization_id = v_device.organization_id
      and is_active;

    insert into public.timefit_user_attendance_qr_sessions(
      organization_id, created_by
    ) values (
      v_device.organization_id, v_device.activated_by
    ) returning id into v_session_id;

    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.timefit_user_mobile_attendance_qr_tokens(
      organization_id,
      display_session_id,
      token_hash,
      work_date,
      issued_at,
      expires_at,
      is_active,
      created_by
    ) values (
      v_device.organization_id,
      v_session_id,
      encode(extensions.digest(v_token, 'sha256'), 'hex'),
      (v_now at time zone coalesce(v_settings.timezone, 'Asia/Seoul'))::date,
      v_now,
      'infinity'::timestamptz,
      true,
      v_device.activated_by
    );
    insert into public.timefit_user_attendance_static_qr(
      organization_id, session_id, token_value, created_by, created_at
    ) values (
      v_device.organization_id,
      v_session_id,
      v_token,
      v_device.activated_by,
      v_now
    ) returning * into v_static;
  end if;

  update public.timefit_user_tablet_devices
  set last_used_at = v_now
  where id = v_device.id;

  return jsonb_build_object(
    'sessionId', v_static.session_id,
    'organizationId', v_device.organization_id,
    'organizationName', v_name,
    'token', v_static.token_value,
    'createdAt', v_static.created_at,
    'persistent', true
  );
end;
$$;

revoke all on function public.timefit_user_tablet_static_attendance_qr(text)
  from public;
grant execute on function public.timefit_user_tablet_static_attendance_qr(text)
  to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
