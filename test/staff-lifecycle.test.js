import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261005000100_staff_lifecycle.sql', import.meta.url), 'utf8');

test('퇴사는 이력을 보존하는 상태 전환이며 직원 로그인을 해제한다', () => {
  assert.match(sql, /employment_status\s*=\s*'terminated'/);
  assert.match(sql, /delete from public\.timefit_user_memberships/);
  assert.match(sql, /timefit_user_current_staff_id[\s\S]*employment_status = 'active'/);
  assert.match(sql, /timefit_user_staff_lifecycle_audits/);
});

test('서브관리자는 employee.manage와 담당 범위 검사를 모두 통과해야 한다', () => {
  assert.match(sql, /timefit_user_has_management_permission\(p_organization_id, 'employee\.manage'\)/);
  assert.match(sql, /timefit_user_management_can_access_staff\(p_organization_id, p_staff_id\)/);
});

test('직원 삭제는 최고관리자와 무이력 수동 등록 직원으로 제한한다', () => {
  assert.match(sql, /staff_delete_owner_only/);
  assert.match(sql, /linked_staff_cannot_delete/);
  assert.match(sql, /staff_has_work_history/);
  assert.match(sql, /pg_constraint fk/);
});
