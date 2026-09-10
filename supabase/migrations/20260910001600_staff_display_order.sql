alter table public.timefit_user_staff
  add column if not exists sort_order integer not null default 0;

create index if not exists timefit_user_staff_display_order_idx
  on public.timefit_user_staff(organization_id, sort_order, created_at);
