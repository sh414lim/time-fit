alter table public.timefit_user_staff add column if not exists phone_last4 char(4) check (phone_last4 ~ '^[0-9]{4}$');
create table if not exists public.timefit_user_organization_settings (
  organization_id uuid primary key references public.timefit_user_organizations(id) on delete cascade,
  workplace_name text,
  address text,
  timezone text not null default 'Asia/Seoul',
  standard_break_minutes integer not null default 60 check (standard_break_minutes between 0 and 480),
  attendance_method text not null default 'phone_last4' check (attendance_method in ('phone_last4')),
  tablet_pin char(4) not null default '0000' check (tablet_pin ~ '^[0-9]{4}$'),
  tablet_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.timefit_user_organization_settings enable row level security;
create policy "manager manages timefit settings" on public.timefit_user_organization_settings for all using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
create policy "member reads timefit settings" on public.timefit_user_organization_settings for select using (public.timefit_user_is_member(organization_id));
create trigger timefit_user_settings_updated_at before update on public.timefit_user_organization_settings for each row execute procedure public.set_updated_at();
insert into public.timefit_user_organization_settings(organization_id, workplace_name) select id, name from public.timefit_user_organizations on conflict(organization_id) do nothing;
grant select, insert, update on public.timefit_user_organization_settings to authenticated;
select pg_notify('pgrst','reload schema');
