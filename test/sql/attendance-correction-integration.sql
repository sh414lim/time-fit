-- Run against an isolated test database after the workforce schema and migration.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000011');
insert into timefit_user_organizations(name,id,owner_id) values ('근태 테스트','10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011');
insert into timefit_user_staff(id,organization_id) values ('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
do $$
declare
  v_org uuid := '10000000-0000-0000-0000-000000000011';
  v_staff uuid := '20000000-0000-0000-0000-000000000011';
  v_date date := (now() at time zone 'Asia/Seoul')::date - 2;
  v_in timestamptz; v_result jsonb; v_stamp timestamptz; v_failed boolean;
begin
  v_in := (v_date + time '09:00') at time zone 'Asia/Seoul';
  v_result := timefit_user_correct_attendance(v_org,v_staff,v_date,v_in,v_in+interval '9 hours','기록 확인',null);
  if v_result->>'source' <> 'manager_correction' then raise exception 'source missing'; end if;
  if (select count(*) from timefit_user_attendance_corrections where staff_id=v_staff) <> 1 then raise exception 'audit missing'; end if;
  if (select before_record is not null from timefit_user_attendance_corrections where staff_id=v_staff) then raise exception 'new record before must be null'; end if;
  v_stamp := (v_result->>'updated_at')::timestamptz;

  v_failed := false;
  begin perform timefit_user_correct_attendance(v_org,v_staff,v_date,v_in,v_in+interval '10 hours','충돌 테스트',null);
  exception when others then v_failed := sqlerrm like '%변경되었습니다%'; end;
  if not v_failed then raise exception 'stale form was accepted'; end if;

  v_failed := false;
  begin perform timefit_user_correct_attendance(v_org,v_staff,v_date,v_in,v_in-interval '1 hour','시각 테스트',v_stamp);
  exception when others then v_failed := sqlerrm like '%시각%'; end;
  if not v_failed then raise exception 'invalid clock-out was accepted'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
  v_failed := false;
  begin perform timefit_user_correct_attendance(v_org,v_staff,v_date,v_in,v_in+interval '10 hours','권한 테스트',v_stamp);
  exception when others then v_failed := sqlerrm like '%최고관리자%'; end;
  if not v_failed then raise exception 'non-owner was accepted'; end if;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
  v_result := timefit_user_correct_attendance(v_org,v_staff,v_date,v_in,v_in+interval '10 hours','퇴근 확인 완료',v_stamp);
  if (select count(*) from timefit_user_attendance_corrections where staff_id=v_staff) <> 2 then raise exception 'failed operation wrote an audit or successful update did not'; end if;
  if not exists(select 1 from timefit_user_attendance_corrections where staff_id=v_staff and before_record->>'checked_out_at' is not null and reason='퇴근 확인 완료') then raise exception 'before values missing'; end if;
end $$;
rollback;
