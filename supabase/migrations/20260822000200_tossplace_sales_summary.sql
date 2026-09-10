-- Aggregate the private Toss Place order table inside Postgres so the dashboard
-- remains accurate even when the order history exceeds PostgREST's row limit.
create or replace function public.tossplace_sales_summary(
  p_merchant_id bigint,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  order_count bigint,
  completed_order_count bigint,
  completed_amount bigint,
  cancelled_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint as order_count,
    count(*) filter (where state = 'COMPLETED')::bigint as completed_order_count,
    coalesce(sum(total_amount) filter (where state = 'COMPLETED'), 0)::bigint as completed_amount,
    count(*) filter (where state = 'CANCELLED')::bigint as cancelled_count
  from public.tossplace_orders
  where merchant_id = p_merchant_id
    and (p_from is null or ordered_at >= p_from)
    and (p_to is null or ordered_at <= p_to);
$$;

revoke all on function public.tossplace_sales_summary(bigint, timestamptz, timestamptz) from public;
grant execute on function public.tossplace_sales_summary(bigint, timestamptz, timestamptz) to service_role;
