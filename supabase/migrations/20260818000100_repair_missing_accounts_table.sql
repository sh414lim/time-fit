-- A prior manual cleanup can remove this table while leaving the migration
-- history intact. Recreate it safely so workforce reads never fail.
create table if not exists public.timefit_user_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.timefit_user_role not null default 'employee',
  display_name text not null,
  employee_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Preserve access for existing authentication users after a table restore.
insert into public.timefit_user_accounts (id, role, display_name)
select
  id,
  case when raw_user_meta_data->>'role' = 'manager'
    then 'manager'::public.timefit_user_role
    else 'employee'::public.timefit_user_role
  end,
  coalesce(nullif(raw_user_meta_data->>'display_name', ''), email, '사용자')
from auth.users
on conflict (id) do nothing;

alter table public.timefit_user_accounts enable row level security;

drop policy if exists "timefit_user account self read" on public.timefit_user_accounts;
create policy "timefit_user account self read" on public.timefit_user_accounts
  for select using (id = auth.uid());

drop policy if exists "timefit_user account self update" on public.timefit_user_accounts;
create policy "timefit_user account self update" on public.timefit_user_accounts
  for update using (id = auth.uid()) with check (id = auth.uid());

grant select, update on public.timefit_user_accounts to authenticated;
grant all privileges on public.timefit_user_accounts to service_role;
