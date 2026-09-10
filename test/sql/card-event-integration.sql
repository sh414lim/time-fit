\set ON_ERROR_STOP on

insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
insert into public.timefit_user_organizations(id,name) values ('10000000-0000-0000-0000-000000000001','Finance Test') on conflict do nothing;
insert into public.timefit_user_staff(id,organization_id,display_name) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','테스트 직원') on conflict do nothing;

insert into public.timefit_user_corporate_cards(
  id, organization_id, issuer, nickname, last4, provider, provider_card_id, created_by
) values (
  '30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  '테스트카드','운영비','4821','manual','manual:test-4821','00000000-0000-0000-0000-000000000001'
) on conflict do nothing;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);

select public.timefit_user_import_card_events(
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'csv',
  '[
    {"providerEventId":"approval-001","groupKey":"approval:100001","eventType":"approval","occurredAt":"2026-09-10T09:30:00+09:00","amount":120000,"approvalNumber":"100001","merchantName":"식자재마트"},
    {"providerEventId":"cancel-001","groupKey":"approval:100001","eventType":"partial_cancellation","occurredAt":"2026-09-10T10:10:00+09:00","amount":20000,"approvalNumber":"100001","merchantName":"식자재마트"},
    {"providerEventId":"acquire-001","groupKey":"approval:100001","eventType":"acquisition","occurredAt":"2026-09-11T03:00:00+09:00","amount":120000,"approvalNumber":"100001","merchantName":"식자재마트"}
  ]'::jsonb
);

-- Run the exact same batch again: every event must be reported as duplicate.
select public.timefit_user_import_card_events(
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'csv',
  '[
    {"providerEventId":"approval-001","groupKey":"approval:100001","eventType":"approval","occurredAt":"2026-09-10T09:30:00+09:00","amount":120000,"approvalNumber":"100001","merchantName":"식자재마트"},
    {"providerEventId":"cancel-001","groupKey":"approval:100001","eventType":"partial_cancellation","occurredAt":"2026-09-10T10:10:00+09:00","amount":20000,"approvalNumber":"100001","merchantName":"식자재마트"},
    {"providerEventId":"acquire-001","groupKey":"approval:100001","eventType":"acquisition","occurredAt":"2026-09-11T03:00:00+09:00","amount":120000,"approvalNumber":"100001","merchantName":"식자재마트"}
  ]'::jsonb
);

do $$
declare
  v_event_count integer;
  v_group_count integer;
  v_net bigint;
  v_status text;
begin
  select count(*) into v_event_count from public.timefit_user_card_transaction_events where corporate_card_id = '30000000-0000-0000-0000-000000000001';
  select count(*), max(net_amount), max(status) into v_group_count, v_net, v_status from public.timefit_user_card_transaction_groups where corporate_card_id = '30000000-0000-0000-0000-000000000001';
  if v_event_count <> 3 then raise exception 'expected 3 events, got %',v_event_count; end if;
  if v_group_count <> 1 then raise exception 'expected 1 group, got %',v_group_count; end if;
  if v_net <> 100000 then raise exception 'expected net 100000, got %',v_net; end if;
  if v_status <> 'partially_cancelled' then raise exception 'expected partially_cancelled, got %',v_status; end if;
end $$;

select status, approved_amount, acquired_amount, cancelled_amount, net_amount
from public.timefit_user_card_transaction_groups
where corporate_card_id = '30000000-0000-0000-0000-000000000001';

select (public.timefit_user_disconnect_corporate_card('30000000-0000-0000-0000-000000000001')).status;

do $$
declare
  v_status text;
  v_archived_at timestamptz;
  v_event_count integer;
  v_delete_blocked boolean := false;
begin
  select status, archived_at into v_status, v_archived_at
  from public.timefit_user_corporate_cards
  where id = '30000000-0000-0000-0000-000000000001';
  select count(*) into v_event_count
  from public.timefit_user_card_transaction_events
  where corporate_card_id = '30000000-0000-0000-0000-000000000001';
  if v_status <> 'disconnected' or v_archived_at is null then raise exception 'card was not safely disconnected'; end if;
  if v_event_count <> 3 then raise exception 'events were not preserved'; end if;
  begin
    delete from public.timefit_user_corporate_cards where id = '30000000-0000-0000-0000-000000000001';
  exception when foreign_key_violation then
    v_delete_blocked := true;
  end;
  if not v_delete_blocked then raise exception 'physical card deletion was not blocked'; end if;
end $$;
