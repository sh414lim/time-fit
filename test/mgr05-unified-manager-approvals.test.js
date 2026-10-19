import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20261016000100_mgr05_unified_manager_approvals.sql',import.meta.url),'utf8');
const base=fs.readFileSync(new URL('../supabase/migrations/20261004000500_mob07_manager_approvals.sql',import.meta.url),'utf8');

test('MGR-05 unifies leave schedule and attendance approvals',()=>{assert.match(sql,/item_kind in \('leave','schedule','attendance'\)/);assert.match(sql,/union all[\s\S]*'attendance'/);assert.match(sql,/attendance\.review_correction/);});
test('MGR-05 returns permission-filtered decision context',()=>{assert.match(sql,/'leave_balance'/);assert.match(sql,/'schedule'/);assert.match(sql,/'attendance'/);assert.match(sql,/timefit_user_mobile_can_review_staff/);assert.match(base,/timefit_user_management_can_access_staff/);});
test('MGR-05 employee correction requests are validated and idempotent',()=>{assert.match(sql,/unique\(staff_id,request_key\)/);assert.match(sql,/attendance_correction_one_pending/);assert.match(sql,/invalid_attendance_correction_request/);assert.match(sql,/interval '48 hours'/);});
test('MGR-05 rejects stale or duplicate manager decisions',()=>{assert.match(sql,/approval_already_processed/);assert.match(sql,/approval_context_changed/);assert.match(base,/unique\(actor_id,request_key\)/);assert.match(sql,/pg_advisory_xact_lock/);});
test('MGR-05 writes approved attendance through the audited correction RPC',()=>{assert.match(sql,/perform public\.timefit_user_correct_attendance/);assert.match(sql,/expected_attendance_updated_at/);});
test('MGR-05 notifies the employee after every decision',()=>{assert.match(sql,/timefit_user_notifications/);assert.match(sql,/approval-result:/);assert.match(sql,/on conflict\(recipient_user_id,dedupe_key\) do nothing/);});
