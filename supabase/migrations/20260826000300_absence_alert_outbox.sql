alter table public.timefit_user_organization_settings
  add column if not exists absence_alert_enabled boolean not null default true,
  add column if not exists absence_alert_delay_minutes integer not null default 10 check (absence_alert_delay_minutes between 0 and 120);

create table if not exists public.timefit_user_operational_alerts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.timefit_user_organizations(id) on delete cascade,
  staff_id uuid not null references public.timefit_user_staff(id) on delete cascade,
  schedule_id uuid not null references public.timefit_user_work_schedules(id) on delete cascade,
  alert_type text not null check (alert_type in ('absence_after_scheduled_start')),
  scheduled_for timestamptz not null, message text not null, status text not null default 'queued' check(status in ('queued','sent','read','failed')),
  created_at timestamptz not null default now(), read_at timestamptz,
  unique(schedule_id, alert_type)
);
alter table public.timefit_user_operational_alerts enable row level security;
create policy "manager reads operational alerts" on public.timefit_user_operational_alerts for select using (public.timefit_user_has_membership_role(organization_id,array['manager']::public.timefit_user_role[]));
grant select, insert, update on public.timefit_user_operational_alerts to authenticated, service_role;

create or replace function public.timefit_user_scan_absence_alerts(p_organization_id uuid, p_work_date date default (now() at time zone 'Asia/Seoul')::date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_settings public.timefit_user_organization_settings; v_count integer := 0; v_row record; v_due timestamptz;
begin
 if auth.role() <> 'service_role' and not public.timefit_user_has_membership_role(p_organization_id,array['manager']::public.timefit_user_role[]) then raise exception 'manager_role_required'; end if;
 select * into v_settings from public.timefit_user_organization_settings where organization_id=p_organization_id;
 if v_settings is null or not v_settings.absence_alert_enabled then return jsonb_build_object('created',0); end if;
 for v_row in select s.id schedule_id,s.staff_id,coalesce(a.display_name,st.display_name,'직원') staff_name,s.starts_at from public.timefit_user_work_schedules s join public.timefit_user_staff st on st.id=s.staff_id left join public.timefit_user_accounts a on a.id=st.user_id left join public.timefit_user_attendance_records r on r.staff_id=s.staff_id and r.work_date=s.work_date where s.organization_id=p_organization_id and s.work_date=p_work_date and not s.is_day_off and s.starts_at is not null and r.checked_in_at is null and not exists(select 1 from public.timefit_user_leave_requests l where l.staff_id=s.staff_id and l.status='approved' and p_work_date between l.starts_on and l.ends_on) loop
   v_due := (p_work_date + v_row.starts_at + make_interval(mins=>v_settings.absence_alert_delay_minutes)) at time zone 'Asia/Seoul';
   if now() >= v_due then insert into public.timefit_user_operational_alerts(organization_id,staff_id,schedule_id,alert_type,scheduled_for,message) values(p_organization_id,v_row.staff_id,v_row.schedule_id,'absence_after_scheduled_start',v_due,v_row.staff_name||'님이 '||to_char(v_row.starts_at,'HH24:MI')||' 출근 예정이지만 출근 기록이 없습니다.') on conflict(schedule_id,alert_type) do nothing; if found then v_count:=v_count+1; end if; end if;
 end loop;
 return jsonb_build_object('created',v_count);
end $$;
grant execute on function public.timefit_user_scan_absence_alerts(uuid,date) to authenticated,service_role;
select pg_notify('pgrst','reload schema');
