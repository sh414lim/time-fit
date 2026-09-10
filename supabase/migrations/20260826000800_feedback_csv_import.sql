create policy "manager imports external feedback"
  on public.timefit_user_feedback_items for insert
  with check (
    public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[])
    and source in ('google','naver','kakao','catchtable','other')
  );
