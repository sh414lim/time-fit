alter table public.timefit_user_staff add column if not exists phone_e164 text check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$');
create or replace function public.timefit_user_set_staff_phone(p_staff_id uuid, p_phone text) returns public.timefit_user_staff language plpgsql security definer set search_path=public as $$
declare v_digits text := regexp_replace(p_phone, '\\D', '', 'g'); v_staff public.timefit_user_staff;
begin
  select * into v_staff from public.timefit_user_staff where id=p_staff_id;
  if v_staff.id is null or not public.timefit_user_has_membership_role(v_staff.organization_id,array['manager']::public.timefit_user_role[]) then raise exception 'manager_role_required'; end if;
  if length(v_digits) not in (10,11) then raise exception 'invalid_phone'; end if;
  update public.timefit_user_staff set phone_e164='+82'||case when left(v_digits,1)='0' then substr(v_digits,2) else v_digits end, phone_last4=right(v_digits,4), phone_last8=right(v_digits,8), updated_at=now() where id=p_staff_id returning * into v_staff;
  return v_staff;
end; $$;
grant execute on function public.timefit_user_set_staff_phone(uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');
