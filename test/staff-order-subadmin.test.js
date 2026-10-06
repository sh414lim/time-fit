import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261006000100_staff_order_subadmin.sql', import.meta.url), 'utf8');

test('직원 순서는 직원 테이블을 직접 수정하지 않고 계정별 RPC로 저장한다', () => {
  assert.match(api, /rpc\('timefit_user_reorder_staff'/);
  assert.match(api, /timefit_user_staff_order_preferences/);
  assert.doesNotMatch(api, /staffIds\.map\(\(id, index\).*timefit_user_staff/);
});

test('서브관리자는 직원 조회 또는 관리 권한으로 자신의 순서를 저장한다', () => {
  assert.match(migration, /'employee\.view'/);
  assert.match(migration, /'employee\.manage'/);
  assert.match(migration, /user_id = v_user_id/);
  assert.match(migration, /timefit_user_staff_order_preferences/);
});
