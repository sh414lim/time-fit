import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const supabase = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261013000100_delegated_staff_creation_without_compensation.sql', import.meta.url), 'utf8');

test('employee.manage alone restores delegated staff registration UI', () => {
  assert.match(main, /canManage=\{canManageEmployees\}/);
  assert.match(main, /modal === "employee" && canManageEmployees/);
  assert.doesNotMatch(main, /canRegisterEmployees/);
  assert.match(main, /\{canManageCompensation && \(\s*<>[\s\S]*?급여 형태/);
});

test('delegated staff registration does not grant compensation access', () => {
  assert.match(migration, /employee\.compensation\.manage/);
  assert.match(migration, /if v_can_manage_compensation then[\s\S]*hourly_wage_required/);
  assert.match(migration, /if v_can_manage_compensation then[\s\S]*insert into public\.timefit_user_payroll_contracts/);
  assert.match(migration, /else\s+v_effective_pay_type := 'hourly'/);
});

test('staff order controls are visible before the employee name for delegated viewers', () => {
  assert.match(main, /canReorder=\{canReorderEmployees\}/);
  assert.match(main, /permissions\?\.includes\("employee\.view"\)/);
  assert.match(main, /employee-name-line[\s\S]*?employee-order-controls[\s\S]*?<b>\{e\.name\}<\/b>/);
});

test('delegated staff order is saved and reloaded through account preferences', () => {
  assert.match(supabase, /timefit_user_staff_order_preferences/);
  assert.match(supabase, /rpc\('timefit_user_reorder_staff'/);
  assert.match(supabase, /saveStaffOrder\(\{ organizationId, staffIds \}\)/);
  assert.match(main, /saveStaffOrder\(\{\s*organizationId:[\s\S]*staffIds:/);
});
