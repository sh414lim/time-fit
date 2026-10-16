import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261015000300_mgr04_manager_staff_detail_attendance.sql',import.meta.url),'utf8');

test('MGR-04 scopes directory and detail records by current staff access',()=>{assert.match(sql,/timefit_user_management_can_access_staff\(p_organization_id,staff\.id\)/);assert.match(sql,/staff_detail_denied/);assert.match(sql,/staff_directory_denied/);});
test('MGR-04 omits compensation unless the dedicated permission is current',()=>{assert.match(sql,/employee\.compensation\.view/);assert.match(sql,/if v_can_compensation then v_result:=v_result\|\|jsonb_build_object\('compensation'/);});
test('MGR-04 returns permission-filtered attendance schedule leave and history sections',()=>{for(const field of ['attendance','schedule','leave','history'])assert.match(sql,new RegExp(`jsonb_build_object\\('${field}'`));assert.match(sql,/capabilities/);});
test('MGR-04 corrections are idempotent audited and optimistic',()=>{assert.match(sql,/unique\(actor_id,request_key\)/);assert.match(sql,/attendance_record_changed/);assert.match(sql,/timefit_user_attendance_corrections/);assert.match(sql,/needs_review=false/);});
test('MGR-04 mobile correction requires attendance.manage rather than review-only access',()=>{assert.match(sql,/has_management_permission\(p_organization_id,'attendance\.manage'\) and public\.timefit_user_management_can_access_staff/);});
