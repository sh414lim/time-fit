-- Atomic receipt/card matching. A card transaction group can be attached to
-- only one expense through the expense_sources unique constraint.
create or replace function public.timefit_user_review_expense_match(
  p_match_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.timefit_user_expense_matches;
  v_document_status text;
begin
  if p_action not in ('confirm','reject','unlink') then raise exception 'review_action_invalid'; end if;

  select * into v_match from public.timefit_user_expense_matches where id = p_match_id for update;
  if v_match.id is null then raise exception 'match_not_found'; end if;
  if not public.timefit_user_has_membership_role(v_match.organization_id,array['manager']::public.timefit_user_role[]) then
    raise exception 'forbidden';
  end if;

  if p_action = 'confirm' then
    if v_match.expense_id is null or v_match.transaction_group_id is null then raise exception 'match_incomplete'; end if;
    insert into public.timefit_user_expense_sources(
      organization_id, expense_id, source_type, source_id, is_primary, match_reason
    ) values (
      v_match.organization_id, v_match.expense_id, 'card_transaction_group',
      v_match.transaction_group_id::text, false,
      jsonb_build_object('matchId',v_match.id,'score',v_match.score,'confirmedBy',auth.uid())
    ) on conflict (organization_id, source_type, source_id) do update
      set expense_id = excluded.expense_id, match_reason = excluded.match_reason
      where public.timefit_user_expense_sources.expense_id = excluded.expense_id;

    if not exists (
      select 1 from public.timefit_user_expense_sources
      where organization_id = v_match.organization_id
        and source_type = 'card_transaction_group'
        and source_id = v_match.transaction_group_id::text
        and expense_id = v_match.expense_id
    ) then raise exception 'card_transaction_already_linked'; end if;

    update public.timefit_user_expense_matches set status = 'confirmed', decided_by = auth.uid(), decided_at = now()
    where id = v_match.id;
    update public.timefit_user_expense_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where document_id = v_match.document_id and id <> v_match.id and status = 'suggested';
    update public.timefit_user_expenses set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now()
    where id = v_match.expense_id;
    update public.timefit_user_card_transaction_groups set reconciliation_status = 'matched', updated_at = now()
    where id = v_match.transaction_group_id;
    v_document_status := 'matched';
  elsif p_action = 'reject' then
    if v_match.status = 'confirmed' then raise exception 'confirmed_match_requires_unlink'; end if;
    update public.timefit_user_expense_matches set status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where id = v_match.id;
    v_document_status := 'review_required';
  else
    if v_match.status <> 'confirmed' then raise exception 'confirmed_match_not_found'; end if;
    delete from public.timefit_user_expense_sources
    where organization_id = v_match.organization_id and expense_id = v_match.expense_id
      and source_type = 'card_transaction_group' and source_id = v_match.transaction_group_id::text;
    update public.timefit_user_expense_matches set status = 'unlinked', decided_by = auth.uid(), decided_at = now()
    where id = v_match.id;
    update public.timefit_user_expenses set status = 'review_required', confirmed_by = null, confirmed_at = null, updated_at = now()
    where id = v_match.expense_id;
    update public.timefit_user_card_transaction_groups set reconciliation_status = 'unreviewed', updated_at = now()
    where id = v_match.transaction_group_id;
    v_document_status := 'review_required';
  end if;

  if v_match.document_id is not null then
    update public.timefit_user_finance_documents set processing_status = v_document_status where id = v_match.document_id;
  end if;
  insert into public.timefit_user_expense_audit_logs(
    organization_id, entity_type, entity_id, action, before_value, after_value, actor_id, source
  ) values (
    v_match.organization_id, 'expense_match', v_match.id, 'match_' || p_action,
    jsonb_build_object('status',v_match.status), jsonb_build_object('status',case when p_action='confirm' then 'confirmed' when p_action='reject' then 'rejected' else 'unlinked' end),
    auth.uid(), 'user'
  );
  return jsonb_build_object('matchId',v_match.id,'expenseId',v_match.expense_id,'action',p_action,'documentStatus',v_document_status);
end $$;

revoke all on function public.timefit_user_review_expense_match(uuid,text) from public;
grant execute on function public.timefit_user_review_expense_match(uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');
