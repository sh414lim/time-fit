create table if not exists public.timefit_user_feedback_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  source text not null default 'internal' check (source in ('internal','google','naver','kakao','catchtable','other')),
  external_id text,
  kind text not null default 'complaint' check (kind in ('review','complaint','suggestion')),
  author_name text,
  rating numeric(2,1) check (rating is null or (rating >= 0 and rating <= 5)),
  content text not null,
  occurred_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','in_progress','resolved','archived')),
  manager_note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index if not exists timefit_feedback_organization_created_idx on public.timefit_user_feedback_items(organization_id, created_at desc);
create trigger timefit_user_feedback_items_updated_at before update on public.timefit_user_feedback_items for each row execute procedure public.set_updated_at();
alter table public.timefit_user_feedback_items enable row level security;
create policy "members read feedback" on public.timefit_user_feedback_items for select using (public.timefit_user_is_member(organization_id));
create policy "members create internal feedback" on public.timefit_user_feedback_items for insert with check (public.timefit_user_is_member(organization_id) and source = 'internal' and created_by = auth.uid());
create policy "manager manages feedback" on public.timefit_user_feedback_items for update using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select, insert, update on public.timefit_user_feedback_items to authenticated;

create table if not exists public.timefit_user_meeting_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  title text not null,
  meeting_at timestamptz not null default now(),
  body text not null default '',
  action_items jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists timefit_meeting_notes_organization_meeting_idx on public.timefit_user_meeting_notes(organization_id, meeting_at desc);
create trigger timefit_user_meeting_notes_updated_at before update on public.timefit_user_meeting_notes for each row execute procedure public.set_updated_at();
alter table public.timefit_user_meeting_notes enable row level security;
create policy "members read meeting notes" on public.timefit_user_meeting_notes for select using (public.timefit_user_is_member(organization_id));
create policy "manager manages meeting notes" on public.timefit_user_meeting_notes for all using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[])) with check (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select, insert, update, delete on public.timefit_user_meeting_notes to authenticated;

select pg_notify('pgrst', 'reload schema');
