-- Keep store tablets signed in until an administrator explicitly revokes them.
-- Active sessions use a rolling one-year expiry so an in-use tablet does not
-- unexpectedly return to the activation screen.

alter table public.timefit_user_tablet_devices
  alter column expires_at set default (now() + interval '365 days');

update public.timefit_user_tablet_devices
set expires_at = greatest(expires_at, now() + interval '365 days')
where status = 'active';

create or replace function public.timefit_user_refresh_tablet_device_expiry()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active'
     and new.last_used_at is distinct from old.last_used_at then
    new.expires_at := greatest(new.expires_at, now() + interval '365 days');
  end if;
  return new;
end;
$$;

drop trigger if exists timefit_user_tablet_device_refresh_expiry
  on public.timefit_user_tablet_devices;
create trigger timefit_user_tablet_device_refresh_expiry
before update on public.timefit_user_tablet_devices
for each row
execute function public.timefit_user_refresh_tablet_device_expiry();

create or replace function public.timefit_user_activate_tablet_device(
  p_organization_id uuid,
  p_display_name text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_device public.timefit_user_tablet_devices;
begin
  if not public.timefit_user_has_membership_role(
    p_organization_id,
    array['manager']::public.timefit_user_role[]
  ) then
    raise exception 'tablet_manager_required';
  end if;

  if nullif(trim(p_display_name), '') is null then
    raise exception 'tablet_name_required';
  end if;

  -- Do not revoke other active devices merely because they share a display
  -- name. Store tablets commonly use the same default name, and revoking by
  -- name caused an already-running tablet to be logged out during activation.
  v_token := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');

  insert into public.timefit_user_tablet_devices(
    organization_id,
    display_name,
    token_hash,
    activated_by,
    expires_at,
    metadata
  )
  values(
    p_organization_id,
    trim(p_display_name),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    auth.uid(),
    now() + interval '365 days',
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_device;

  return jsonb_build_object(
    'deviceToken', v_token,
    'deviceId', v_device.id,
    'organizationId', v_device.organization_id,
    'displayName', v_device.display_name,
    'expiresAt', v_device.expires_at
  );
end;
$$;

grant execute on function public.timefit_user_activate_tablet_device(uuid, text, jsonb)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
