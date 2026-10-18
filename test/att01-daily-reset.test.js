import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261018000200_qr_daily_reset.sql', import.meta.url), 'utf8');

test('새 근무일에는 전날 미퇴근을 관리자 확인으로 남기고 오늘 출근을 허용한다', () => {
  assert.match(sql, /v_record\.work_date<v_today/);
  assert.match(sql, /set needs_review=true,status='needs_review'/);
  assert.match(sql, /v_previous_needs_review:=true/);
  assert.match(sql, /v_record:=null/);
  assert.match(sql, /'previousNeedsReview',v_previous_needs_review/);
  assert.doesNotMatch(sql, /delete from public\.timefit_user_attendance_records/i);
});

test('승인된 자정 넘김 스케줄만 제한 시간 안에 전날 퇴근으로 연결한다', () => {
  assert.match(sql, /schedule\.approval_status='approved'/);
  assert.match(sql, /schedule\.ends_at<=schedule\.starts_at/);
  assert.match(sql, /v_record\.work_date=v_today-1/);
  assert.match(sql, /interval '4 hours'/);
  assert.match(sql, /interval '18 hours'/);
});

test('오늘 상태 조회는 오늘 기록을 우선하고 과거 미퇴근으로 새 근무일을 막지 않는다', () => {
  const todayLookup = sql.indexOf('where staff_id=v_staff.id and work_date=v_today limit 1');
  const priorLookup = sql.indexOf('where staff_id=v_staff.id and work_date<v_today');
  assert.ok(todayLookup > 0 && priorLookup > todayLookup);
  assert.match(sql, /when v_record\.id is null then 'check_in'/);
});
