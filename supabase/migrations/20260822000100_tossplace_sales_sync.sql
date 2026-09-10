-- Toss Place sales data is kept separate from TimeFit workforce data.
-- Only the server-side Supabase service role may read or write these tables.

create table if not exists public.tossplace_orders (
  merchant_id bigint not null,
  order_id text not null,
  order_key text,
  state text,
  source text,
  ordered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  total_amount bigint,
  raw_order jsonb not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, order_id)
);

create index if not exists tossplace_orders_merchant_completed_at_idx
  on public.tossplace_orders (merchant_id, completed_at desc);

create index if not exists tossplace_orders_merchant_synced_at_idx
  on public.tossplace_orders (merchant_id, synced_at desc);

create table if not exists public.tossplace_sync_state (
  merchant_id bigint primary key,
  last_successful_sync_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_error text,
  updated_at timestamptz not null default now()
);

alter table public.tossplace_orders enable row level security;
alter table public.tossplace_sync_state enable row level security;

-- No policies are intentionally created. Client/anon access is denied; the
-- Vercel backend uses the Supabase service role for this private integration.
