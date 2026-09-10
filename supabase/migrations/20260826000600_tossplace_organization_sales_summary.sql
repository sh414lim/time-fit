create or replace function public.timefit_user_tossplace_sales_summary(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table(order_count bigint, completed_order_count bigint, completed_amount bigint, cancelled_count bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*)::bigint as order_count,
    count(*) filter (where coalesce(state,'') not ilike '%cancel%')::bigint as completed_order_count,
    coalesce(sum(total_amount) filter (where coalesce(state,'') not ilike '%cancel%'), 0)::bigint as completed_amount,
    count(*) filter (where coalesce(state,'') ilike '%cancel%')::bigint as cancelled_count
  from public.tossplace_orders
  where organization_id = p_organization_id
    and (p_from is null or ordered_at >= p_from)
    and (p_to is null or ordered_at <= p_to);
$$;

grant execute on function public.timefit_user_tossplace_sales_summary(uuid,timestamptz,timestamptz) to service_role;
