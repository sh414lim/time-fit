-- Allow the trusted server-side card sync worker to reuse the same validated,
-- idempotent import path. Browser clients still need manager membership.
create or replace function public.timefit_user_import_card_events(
  p_organization_id uuid,
  p_corporate_card_id uuid,
  p_provider text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.timefit_user_corporate_cards;
  v_event jsonb;
  v_group_id uuid;
  v_group_key text;
  v_provider_event_id text;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_affected_groups uuid[] := '{}'::uuid[];
  v_approved bigint;
  v_acquired bigint;
  v_cancelled bigint;
  v_billed bigint;
  v_net bigint;
  v_status text;
begin
  if auth.role() <> 'service_role'
     and not public.timefit_user_has_membership_role(p_organization_id,array['manager']::public.timefit_user_role[]) then
    raise exception 'forbidden';
  end if;
  if p_provider not in ('csv','api','manual','mock','email') then raise exception 'provider_invalid'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 1000 then raise exception 'events_invalid'; end if;

  select * into v_card from public.timefit_user_corporate_cards
  where id = p_corporate_card_id and organization_id = p_organization_id and archived_at is null for update;
  if v_card.id is null then raise exception 'card_not_found'; end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_group_key := nullif(trim(v_event->>'groupKey'),'');
    v_provider_event_id := nullif(trim(v_event->>'providerEventId'),'');
    if v_group_key is null or v_provider_event_id is null then raise exception 'event_identity_missing'; end if;
    if coalesce((v_event->>'amount')::bigint,-1) < 0 then raise exception 'event_amount_invalid'; end if;
    if (v_event->>'eventType') not in ('approval','cancellation','partial_cancellation','acquisition','billing','payment') then raise exception 'event_type_invalid'; end if;

    insert into public.timefit_user_card_transaction_groups(
      organization_id, corporate_card_id, provider_group_key, approved_at,
      approval_number, merchant_name, reconciliation_status
    ) values (
      p_organization_id, p_corporate_card_id, v_group_key, (v_event->>'occurredAt')::timestamptz,
      nullif(v_event->>'approvalNumber',''), nullif(v_event->>'merchantName',''), 'unreviewed'
    ) on conflict (organization_id, corporate_card_id, provider_group_key)
      where provider_group_key is not null do update set
      approval_number = coalesce(excluded.approval_number, public.timefit_user_card_transaction_groups.approval_number),
      merchant_name = coalesce(excluded.merchant_name, public.timefit_user_card_transaction_groups.merchant_name), updated_at = now()
    returning id into v_group_id;

    insert into public.timefit_user_card_transaction_events(
      organization_id, transaction_group_id, corporate_card_id, provider, provider_event_id,
      event_type, occurred_at, amount, currency, approval_number, original_provider_event_id,
      merchant_name, merchant_business_number, raw_checksum, imported_by
    ) values (
      p_organization_id, v_group_id, p_corporate_card_id, p_provider, v_provider_event_id,
      v_event->>'eventType', (v_event->>'occurredAt')::timestamptz, (v_event->>'amount')::bigint,
      coalesce(nullif(v_event->>'currency',''),'KRW'), nullif(v_event->>'approvalNumber',''),
      nullif(v_event->>'originalProviderEventId',''), nullif(v_event->>'merchantName',''),
      nullif(v_event->>'merchantBusinessNumber',''), nullif(v_event->>'rawChecksum',''), auth.uid()
    ) on conflict (organization_id, provider, provider_event_id) do nothing;

    if found then v_inserted := v_inserted + 1; else v_duplicates := v_duplicates + 1; end if;
    if not (v_group_id = any(v_affected_groups)) then v_affected_groups := array_append(v_affected_groups,v_group_id); end if;
  end loop;

  foreach v_group_id in array v_affected_groups loop
    select coalesce(sum(amount) filter (where event_type = 'approval'),0),
      coalesce(max(amount) filter (where event_type = 'acquisition'),0),
      coalesce(sum(amount) filter (where event_type in ('cancellation','partial_cancellation')),0),
      max(amount) filter (where event_type = 'billing')
    into v_approved, v_acquired, v_cancelled, v_billed
    from public.timefit_user_card_transaction_events where transaction_group_id = v_group_id;
    v_net := greatest(0, coalesce(v_billed, nullif(v_acquired,0), v_approved) - v_cancelled);
    v_status := case when v_cancelled > 0 and v_net = 0 then 'cancelled'
      when v_cancelled > 0 then 'partially_cancelled' when v_billed is not null then 'billed'
      when v_acquired > 0 then 'acquired' else 'pending' end;
    update public.timefit_user_card_transaction_groups set approved_amount = v_approved,
      acquired_amount = v_acquired, cancelled_amount = v_cancelled, net_amount = v_net,
      status = v_status,
      acquired_at = (select max(occurred_at) from public.timefit_user_card_transaction_events where transaction_group_id = v_group_id and event_type = 'acquisition'),
      billed_at = (select max(occurred_at) from public.timefit_user_card_transaction_events where transaction_group_id = v_group_id and event_type = 'billing'),
      updated_at = now() where id = v_group_id;
  end loop;

  update public.timefit_user_corporate_cards set last_synced_at = now(), updated_at = now()
  where id = p_corporate_card_id;
  insert into public.timefit_user_expense_audit_logs(organization_id, entity_type, entity_id, action, after_value, actor_id, source)
  values(p_organization_id, 'corporate_card', p_corporate_card_id, 'events_imported', jsonb_build_object('provider',p_provider,'inserted',v_inserted,'duplicates',v_duplicates), auth.uid(), p_provider);
  return jsonb_build_object('imported',v_inserted,'duplicates',v_duplicates,'groups',coalesce(array_length(v_affected_groups,1),0));
end $$;

revoke all on function public.timefit_user_import_card_events(uuid,uuid,text,jsonb) from public;
grant execute on function public.timefit_user_import_card_events(uuid,uuid,text,jsonb) to authenticated, service_role;
select pg_notify('pgrst','reload schema');
