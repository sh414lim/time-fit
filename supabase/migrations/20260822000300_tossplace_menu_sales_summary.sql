-- Menu-level totals are calculated from the line items saved with each completed
-- Toss Place order. Gross amount includes item and selected-option prices; it
-- deliberately excludes order-level discounts/tips because those are not tied
-- to a single menu item in the Open API model.
create or replace function public.tossplace_menu_sales_summary(
  p_merchant_id bigint,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100
)
returns table (
  menu_name text,
  menu_code text,
  category_name text,
  sold_quantity bigint,
  gross_sales_amount bigint,
  order_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with completed_lines as (
    select
      order_id,
      line_item,
      coalesce((line_item->'item'->>'title'), '이름 없는 메뉴') as menu_name,
      nullif(line_item->'item'->>'code', '') as menu_code,
      nullif(line_item->'item'->'category'->>'title', '') as category_name,
      coalesce((line_item->>'quantity')::bigint, 0) as quantity,
      coalesce((line_item->'itemPrice'->>'priceValue')::bigint, 0)
        * coalesce((line_item->'itemPrice'->>'priceUnit')::bigint, 1) as item_unit_price,
      coalesce((
        select sum(
          coalesce((choice->>'priceValue')::bigint, 0)
          * coalesce((choice->>'quantity')::bigint, 1)
        )
        from jsonb_array_elements(coalesce(line_item->'optionChoices', '[]'::jsonb)) as choice
      ), 0) as option_amount
    from public.tossplace_orders
    cross join lateral jsonb_array_elements(coalesce(raw_order->'lineItems', '[]'::jsonb)) as line_item
    where merchant_id = p_merchant_id
      and state = 'COMPLETED'
      and (p_from is null or ordered_at >= p_from)
      and (p_to is null or ordered_at <= p_to)
  )
  select
    menu_name,
    menu_code,
    category_name,
    sum(quantity)::bigint as sold_quantity,
    sum((item_unit_price * quantity) + option_amount)::bigint as gross_sales_amount,
    count(distinct order_id)::bigint as order_count
  from completed_lines
  group by menu_name, menu_code, category_name
  order by gross_sales_amount desc, sold_quantity desc, menu_name asc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.tossplace_menu_sales_summary(bigint, timestamptz, timestamptz, integer) from public;
grant execute on function public.tossplace_menu_sales_summary(bigint, timestamptz, timestamptz, integer) to service_role;
