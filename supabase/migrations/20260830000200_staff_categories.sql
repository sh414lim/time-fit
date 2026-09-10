-- Business-defined staff categories (for example: 홀, 주방).
create table if not exists public.timefit_user_staff_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 30),
  color text not null default '#3182F6' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.timefit_user_staff
  add column if not exists category_id uuid references public.timefit_user_staff_categories(id) on delete set null;
create index if not exists timefit_user_staff_category_idx on public.timefit_user_staff(organization_id, category_id);
create index if not exists timefit_user_staff_categories_org_idx on public.timefit_user_staff_categories(organization_id, sort_order, name);

-- Keep historic free-text departments useful: each existing value becomes a category.
with legacy_categories as (
  select organization_id, trim(department) as name,
    (array['#3182F6','#00A86B','#8B5CF6','#F97316','#E65F5C','#0EA5E9'])[
      1 + (row_number() over (partition by organization_id order by trim(department)) - 1)::int % 6
    ] as color,
    row_number() over (partition by organization_id order by trim(department))::int as sort_order
  from (select distinct organization_id, department from public.timefit_user_staff where nullif(trim(department),'') is not null) source
)
insert into public.timefit_user_staff_categories(organization_id, name, color, sort_order)
select organization_id, name, color, sort_order from legacy_categories
on conflict (organization_id, name) do nothing;

insert into public.timefit_user_staff_categories(organization_id, name, color, sort_order)
select id, '미분류', '#8B95A1', 999 from public.timefit_user_organizations
on conflict (organization_id, name) do nothing;

update public.timefit_user_staff staff
set category_id = category.id,
    department = category.name
from public.timefit_user_staff_categories category
where category.organization_id = staff.organization_id
  and category.name = coalesce(nullif(trim(staff.department), ''), '미분류')
  and staff.category_id is null;

alter table public.timefit_user_staff_categories enable row level security;
create policy "staff category members read" on public.timefit_user_staff_categories
  for select using (public.timefit_user_is_member(organization_id));
create policy "staff category managers manage" on public.timefit_user_staff_categories
  for all using (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]))
  with check (public.timefit_user_has_membership_role(organization_id, array['manager']::public.timefit_user_role[]));
grant select, insert, update, delete on public.timefit_user_staff_categories to authenticated;

drop trigger if exists timefit_staff_categories_updated_at on public.timefit_user_staff_categories;
create trigger timefit_staff_categories_updated_at before update on public.timefit_user_staff_categories
for each row execute procedure public.set_updated_at();

create or replace function public.timefit_user_reassign_deleted_staff_category() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_uncategorized_id uuid;
begin
  if old.name = '미분류' then raise exception 'uncategorized_category_required'; end if;
  select id into v_uncategorized_id from public.timefit_user_staff_categories
    where organization_id=old.organization_id and name='미분류' limit 1;
  update public.timefit_user_staff
    set category_id=v_uncategorized_id, department='미분류'
    where organization_id=old.organization_id and category_id=old.id;
  return old;
end $$;
drop trigger if exists timefit_staff_categories_reassign_before_delete on public.timefit_user_staff_categories;
create trigger timefit_staff_categories_reassign_before_delete before delete on public.timefit_user_staff_categories
for each row execute procedure public.timefit_user_reassign_deleted_staff_category();

-- Category ID is optional for backward-compatible calls; when present it is
-- validated against the manager's organization and the readable name is stored
-- in department for older integrations.
drop function if exists public.timefit_user_create_manual_staff(text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date);
create function public.timefit_user_create_manual_staff(
  p_name text, p_phone text, p_department text default null, p_job_title text default null,
  p_pay_type public.timefit_user_pay_type default 'hourly', p_hourly_wage numeric default null,
  p_daily_wage numeric default null, p_monthly_salary numeric default null,
  p_annual_salary numeric default null, p_joined_on date default current_date,
  p_category_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid; v_digits text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'); v_id uuid; v_category_name text;
begin
  select organization_id into v_org from public.timefit_user_memberships where user_id=auth.uid() and role='manager' limit 1;
  if v_org is null then raise exception 'manager_role_required'; end if;
  if p_category_id is not null then
    select name into v_category_name from public.timefit_user_staff_categories where id=p_category_id and organization_id=v_org;
    if v_category_name is null then raise exception 'invalid_staff_category'; end if;
  end if;
  if nullif(trim(p_name),'') is null then raise exception 'name_required'; end if;
  if length(v_digits) not in (10,11) then raise exception 'invalid_phone'; end if;
  if p_pay_type='hourly' and coalesce(p_hourly_wage,0)<=0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type='daily' and coalesce(p_daily_wage,0)<=0 then raise exception 'daily_wage_required'; end if;
  if p_pay_type='monthly' and coalesce(p_monthly_salary,0)<=0 then raise exception 'monthly_salary_required'; end if;
  if p_pay_type='annual' and coalesce(p_annual_salary,0)<=0 then raise exception 'annual_salary_required'; end if;
  insert into public.timefit_user_staff(organization_id,user_id,display_name,department,category_id,job_title,pay_type,hourly_wage,daily_wage,monthly_salary,annual_salary,joined_on,phone_e164,phone_last4,phone_last8,registration_type)
  values(v_org,null,trim(p_name),coalesce(v_category_name,nullif(trim(p_department),'')),p_category_id,coalesce(nullif(trim(p_job_title),''),'직원'),p_pay_type,
    case when p_pay_type='hourly' then p_hourly_wage else null end, case when p_pay_type='daily' then p_daily_wage else null end,
    case when p_pay_type='monthly' then p_monthly_salary else null end, case when p_pay_type='annual' then p_annual_salary else null end,
    coalesce(p_joined_on,current_date),'+82'||case when left(v_digits,1)='0' then substr(v_digits,2) else v_digits end,right(v_digits,4),right(v_digits,8),'manual') returning id into v_id;
  return v_id;
end $$;

drop function if exists public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date);
create function public.timefit_user_update_staff_profile(
  p_staff_id uuid, p_name text, p_phone text, p_department text, p_job_title text,
  p_pay_type public.timefit_user_pay_type, p_hourly_wage numeric, p_daily_wage numeric,
  p_monthly_salary numeric, p_annual_salary numeric, p_joined_on date, p_category_id uuid default null
) returns public.timefit_user_staff language plpgsql security definer set search_path=public as $$
declare v_staff public.timefit_user_staff; v_digits text; v_category_name text;
begin
  select * into v_staff from public.timefit_user_staff where id=p_staff_id;
  if v_staff is null then raise exception 'staff_not_found'; end if;
  if not public.timefit_user_has_membership_role(v_staff.organization_id,array['manager']::public.timefit_user_role[]) then raise exception 'not_authorized'; end if;
  if p_category_id is not null then
    select name into v_category_name from public.timefit_user_staff_categories where id=p_category_id and organization_id=v_staff.organization_id;
    if v_category_name is null then raise exception 'invalid_staff_category'; end if;
  end if;
  if nullif(trim(p_name),'') is null or nullif(trim(p_job_title),'') is null or p_joined_on is null then raise exception 'required_field_missing'; end if;
  v_digits := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if v_digits !~ '^01[0-9][0-9]{7,8}$' then raise exception 'invalid_phone'; end if;
  if p_pay_type='hourly' and coalesce(p_hourly_wage,0)<=0 then raise exception 'hourly_wage_required'; end if;
  if p_pay_type='daily' and coalesce(p_daily_wage,0)<=0 then raise exception 'daily_wage_required'; end if;
  if p_pay_type='monthly' and coalesce(p_monthly_salary,0)<=0 then raise exception 'monthly_salary_required'; end if;
  if p_pay_type='annual' and coalesce(p_annual_salary,0)<=0 then raise exception 'annual_salary_required'; end if;
  update public.timefit_user_staff set display_name=trim(p_name),phone_e164='+82'||substr(v_digits,2),phone_last4=right(v_digits,4),phone_last8=right(v_digits,8),department=coalesce(v_category_name,nullif(trim(p_department),'')),category_id=case when p_category_id is null then category_id else p_category_id end,job_title=trim(p_job_title),pay_type=p_pay_type,hourly_wage=case when p_pay_type='hourly' then p_hourly_wage else null end,daily_wage=case when p_pay_type='daily' then p_daily_wage else null end,monthly_salary=case when p_pay_type='monthly' then p_monthly_salary else null end,annual_salary=case when p_pay_type='annual' then p_annual_salary else null end,joined_on=p_joined_on where id=p_staff_id returning * into v_staff;
  if v_staff.user_id is not null then update public.timefit_user_accounts set display_name=trim(p_name) where id=v_staff.user_id; end if;
  return v_staff;
end $$;

grant execute on function public.timefit_user_create_manual_staff(text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date,uuid) to authenticated;
grant execute on function public.timefit_user_update_staff_profile(uuid,text,text,text,text,public.timefit_user_pay_type,numeric,numeric,numeric,numeric,date,uuid) to authenticated;
select pg_notify('pgrst','reload schema');
