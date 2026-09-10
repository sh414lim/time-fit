-- Keep one compact sales row per business / store / KST calendar day.
-- The dashboard reads this table; raw orders remain available for detail.
create table if not exists public.timefit_user_tossplace_daily_sales (
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  merchant_id bigint not null,
  sales_date date not null,
  order_count bigint not null default 0,
  completed_order_count bigint not null default 0,
  completed_amount bigint not null default 0,
  cancelled_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (organization_id, merchant_id, sales_date)
);

create index if not exists timefit_user_tossplace_daily_sales_period_idx
  on public.timefit_user_tossplace_daily_sales (organization_id, sales_date desc);

alter table public.timefit_user_tossplace_daily_sales enable row level security;

-- A sync rebuilds the store aggregate outside the interactive request path.
create or replace function public.timefit_user_refresh_tossplace_daily_sales(
  p_organization_id uuid,
  p_merchant_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.timefit_user_tossplace_daily_sales
   where organization_id = p_organization_id
     and merchant_id = p_merchant_id;

  insert into public.timefit_user_tossplace_daily_sales (
    organization_id, merchant_id, sales_date, order_count,
    completed_order_count, completed_amount, cancelled_count, refreshed_at
  )
  select
    organization_id,
    merchant_id,
    (ordered_at at time zone 'Asia/Seoul')::date as sales_date,
    count(*)::bigint,
    count(*) filter (where coalesce(state, '') not ilike '%cancel%')::bigint,
    coalesce(sum(total_amount) filter (where coalesce(state, '') not ilike '%cancel%'), 0)::bigint,
    count(*) filter (where coalesce(state, '') ilike '%cancel%')::bigint,
    now()
  from public.tossplace_orders
  where organization_id = p_organization_id
    and merchant_id = p_merchant_id
    and ordered_at is not null
  group by organization_id, merchant_id, (ordered_at at time zone 'Asia/Seoul')::date;
end;
$$;

-- Seed summaries from any orders that were synchronized before this migration.
insert into public.timefit_user_tossplace_daily_sales (
  organization_id, merchant_id, sales_date, order_count,
  completed_order_count, completed_amount, cancelled_count, refreshed_at
)
select
  organization_id,
  merchant_id,
  (ordered_at at time zone 'Asia/Seoul')::date,
  count(*)::bigint,
  count(*) filter (where coalesce(state, '') not ilike '%cancel%')::bigint,
  coalesce(sum(total_amount) filter (where coalesce(state, '') not ilike '%cancel%'), 0)::bigint,
  count(*) filter (where coalesce(state, '') ilike '%cancel%')::bigint,
  now()
from public.tossplace_orders
where organization_id is not null and ordered_at is not null
group by organization_id, merchant_id, (ordered_at at time zone 'Asia/Seoul')::date
on conflict (organization_id, merchant_id, sales_date) do update set
  order_count = excluded.order_count,
  completed_order_count = excluded.completed_order_count,
  completed_amount = excluded.completed_amount,
  cancelled_count = excluded.cancelled_count,
  refreshed_at = excluded.refreshed_at;

create or replace function public.timefit_user_tossplace_sales_summary(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table(order_count bigint, completed_order_count bigint, completed_amount bigint, cancelled_count bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(order_count), 0)::bigint,
    coalesce(sum(completed_order_count), 0)::bigint,
    coalesce(sum(completed_amount), 0)::bigint,
    coalesce(sum(cancelled_count), 0)::bigint
  from public.timefit_user_tossplace_daily_sales
  where organization_id = p_organization_id
    and (p_from is null or sales_date >= (p_from at time zone 'Asia/Seoul')::date)
    and (p_to is null or sales_date <= (p_to at time zone 'Asia/Seoul')::date);
$$;

revoke all on function public.timefit_user_refresh_tossplace_daily_sales(uuid, bigint) from public;
grant execute on function public.timefit_user_refresh_tossplace_daily_sales(uuid, bigint) to service_role;
revoke all on function public.timefit_user_tossplace_sales_summary(uuid, timestamptz, timestamptz) from public;
grant execute on function public.timefit_user_tossplace_sales_summary(uuid, timestamptz, timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
