create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

do $$ begin
  create type public.timefit_user_role as enum ('employee','manager');
exception when duplicate_object then null;
end $$;

create table if not exists public.timefit_user_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists public.timefit_user_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  display_name text
);

create table if not exists public.timefit_user_finance_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade
);

create or replace function public.timefit_user_has_membership_role(
  p_organization_id uuid,
  p_roles public.timefit_user_role[]
)
returns boolean
language sql
stable
as $$ select true $$;
