create or replace function public.timefit_user_change_closeout_status(
  p_closeout_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closeout public.timefit_user_closeouts;
  v_next_status text;
begin
  select * into v_closeout from public.timefit_user_closeouts where id = p_closeout_id for update;
  if v_closeout.id is null then raise exception 'closeout_not_found'; end if;
  if not exists (select 1 from public.timefit_user_organizations where id = v_closeout.organization_id and owner_id = auth.uid()) then raise exception 'owner_required'; end if;

  if p_action = 'close' then
    if v_closeout.status <> 'ready' then raise exception 'closeout_not_ready'; end if;
    v_next_status := 'closed';
    update public.timefit_user_closeouts set status = 'closed', closed_by = auth.uid(), closed_at = now(), updated_at = now() where id = v_closeout.id;
  elsif p_action = 'reopen' then
    if v_closeout.status <> 'closed' then raise exception 'closeout_not_closed'; end if;
    if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'reopen_reason_required'; end if;
    v_next_status := 'reopened';
    update public.timefit_user_closeouts set status = 'reopened', reopen_reason = trim(p_reason), updated_at = now() where id = v_closeout.id;
  else raise exception 'closeout_action_invalid';
  end if;

  insert into public.timefit_user_expense_audit_logs(organization_id, entity_type, entity_id, action, before_value, after_value, actor_id, source)
  values(v_closeout.organization_id, 'closeout', v_closeout.id, 'closeout_' || p_action,
    jsonb_build_object('status',v_closeout.status), jsonb_build_object('status',v_next_status,'reason',p_reason), auth.uid(), 'user');
  return jsonb_build_object('closeoutId',v_closeout.id,'status',v_next_status);
end $$;

revoke all on function public.timefit_user_change_closeout_status(uuid,text,text) from public;
grant execute on function public.timefit_user_change_closeout_status(uuid,text,text) to authenticated;
select pg_notify('pgrst','reload schema');
