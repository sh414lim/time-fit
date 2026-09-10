-- Employee profile photos are stored privately and are only readable within
-- the same workplace.  Keep the path (not a public URL) on the staff row.
alter table public.timefit_user_staff
  add column if not exists avatar_path text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'timefit-staff-avatars',
  'timefit-staff-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- A manager can manage every photo in their workplace.  Employees may read
-- only their own photo, which keeps signed URLs usable in employee views too.
create policy "staff avatar files readable by workplace" on storage.objects for select
using (
  bucket_id = 'timefit-staff-avatars'
  and (
    public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid, array['manager']::public.timefit_user_role[])
    or exists (
      select 1 from public.timefit_user_staff staff
      where staff.organization_id = (storage.foldername(name))[1]::uuid
        and staff.id = (storage.foldername(name))[2]::uuid
        and staff.user_id = auth.uid()
    )
  )
);

create policy "managers upload staff avatar files" on storage.objects for insert
with check (
  bucket_id = 'timefit-staff-avatars'
  and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid, array['manager']::public.timefit_user_role[])
);

create policy "managers update staff avatar files" on storage.objects for update
using (
  bucket_id = 'timefit-staff-avatars'
  and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid, array['manager']::public.timefit_user_role[])
)
with check (
  bucket_id = 'timefit-staff-avatars'
  and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid, array['manager']::public.timefit_user_role[])
);

create policy "managers delete staff avatar files" on storage.objects for delete
using (
  bucket_id = 'timefit-staff-avatars'
  and public.timefit_user_has_membership_role((storage.foldername(name))[1]::uuid, array['manager']::public.timefit_user_role[])
);

select pg_notify('pgrst', 'reload schema');
