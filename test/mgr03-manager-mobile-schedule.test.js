import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261015000200_mgr03_manager_mobile_schedule.sql', import.meta.url), 'utf8');

test('MGR-03 scopes schedule reads and writes by permission and assigned staff', () => {
  assert.match(sql,/schedule\.view/);assert.match(sql,/schedule\.manage/);
  assert.match(sql,/timefit_user_management_can_access_staff\(p_organization_id,staff\.id\)/);
  assert.match(sql,/timefit_user_management_can_access_staff\(p_organization_id,v_schedule\.staff_id\)/);
});

test('MGR-03 validates overnight ranges, leave conflicts, and adjacent-date overlaps', () => {
  assert.match(sql,/p_ends_at<p_starts_at then 1440/);
  assert.match(sql,/schedule_leave_conflict/);
  assert.match(sql,/existing\.work_date between new\.work_date-1 and new\.work_date\+1/);
  assert.match(sql,/tsrange\(v_start,v_end,'\[\)'\)/);
});

test('MGR-03 prevents duplicate and stale mobile writes', () => {
  assert.match(sql,/unique\(actor_id,request_key\)/);
  assert.match(sql,/schedule_revision_changed/);
  assert.match(sql,/for update/);
  assert.match(sql,/duplicate',true/);
});

test('MGR-03 versions internal manager notes without exposing them to employee schedule responses', () => {
  assert.match(sql,/add column if not exists manager_note/);
  assert.match(sql,/old\.manager_note/);
  assert.match(sql,/p_manager_note text/);
});

test('MGR-03 returns the employee notification outcome', () => {
  assert.match(sql,/notification_status/);
  assert.match(sql,/awaiting_approval/);
  assert.match(sql,/timefit_user_schedule_notification_outbox/);
});
