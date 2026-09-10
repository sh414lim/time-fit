-- The manager screen receives a small, pre-shaped dashboard document from
-- Postgres. Raw orders never travel to the browser: only eight recent rows
-- and pre-aggregated daily figures are returned.
create or replace function public.timefit_user_sales_dashboard(
  p_organization_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with connection as (
    select jsonb_build_object(
      'display_name', c.display_name,
      'service_id', c.service_id,
      'service_code', c.service_code,
      'merchant_id', c.merchant_id,
      'sync_enabled', c.sync_enabled,
      'connection_status', c.connection_status,
      'last_synced_at', c.last_synced_at,
      'last_error', c.last_error
    ) as value
    from public.timefit_user_tossplace_connections c
    where c.organization_id = p_organization_id
    limit 1
  ), sync_state as (
    select jsonb_build_object(
      'last_successful_sync_at', s.last_successful_sync_at,
      'last_sync_started_at', s.last_sync_started_at,
      'last_sync_error', s.last_sync_error,
      'updated_at', s.updated_at
    ) as value
    from public.tossplace_sync_state s
    where s.organization_id = p_organization_id
    order by s.updated_at desc
    limit 1
  ), summary as (
    select jsonb_build_object(
      'order_count', coalesce(sum(order_count), 0),
      'completed_order_count', coalesce(sum(completed_order_count), 0),
      'completed_amount', coalesce(sum(completed_amount), 0),
      'cancelled_count', coalesce(sum(cancelled_count), 0)
    ) as value
    from public.timefit_user_tossplace_daily_sales
    where organization_id = p_organization_id
      and (p_from is null or sales_date >= p_from)
      and (p_to is null or sales_date <= p_to)
  ), recent_orders as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', source.order_id,
      'ordered_at', source.ordered_at,
      'state', source.state,
      'source', source.source,
      'total_amount', source.total_amount
    ) order by source.ordered_at desc), '[]'::jsonb) as value
    from (
      select order_id, ordered_at, state, source, total_amount
      from public.tossplace_orders
      where organization_id = p_organization_id
      order by ordered_at desc nulls last
      limit 8
    ) source
  )
  select jsonb_build_object(
    'connection', coalesce((select value from connection), 'null'::jsonb),
    'syncState', coalesce((select value from sync_state), 'null'::jsonb),
    'summary', (select value from summary),
    'recentOrders', (select value from recent_orders)
  );
$$;

revoke all on function public.timefit_user_sales_dashboard(uuid, date, date) from public;
grant execute on function public.timefit_user_sales_dashboard(uuid, date, date) to service_role;
select pg_notify('pgrst', 'reload schema');
