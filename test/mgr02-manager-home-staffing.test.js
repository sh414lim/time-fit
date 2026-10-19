import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261015000100_mgr02_manager_home_staffing.sql', import.meta.url), 'utf8');

test('MGR-02 persists weekday staffing requirements by organization and category', () => {
  assert.match(sql, /create table if not exists public\.timefit_user_staffing_requirements/);
  assert.match(sql, /primary key\(organization_id,category_id,weekday\)/);
  assert.match(sql, /weekday between 0 and 6/);
});

test('MGR-02 restricts staffing access by current organization permissions', () => {
  assert.match(sql, /timefit_user_is_organization_owner\(p_organization_id\)/);
  assert.match(sql, /timefit_user_has_management_permission\(p_organization_id,'schedule\.view'\)/);
  assert.match(sql, /timefit_user_management_can_access_staff\(p_organization_id,staff\.id\)/);
  assert.match(sql, /timefit_user_mobile_can_access_staffing_category\(p_organization_id,requirement\.category_id\)/);
  assert.match(sql, /timefit_user_management_scopes/);
});

test('MGR-02 reports real today and tomorrow schedule coverage', () => {
  assert.match(sql, /values\(v_today\),\(v_today\+1\)/);
  assert.match(sql, /schedule\.status='published'/);
  assert.match(sql, /schedule\.approval_status='approved'/);
  assert.match(sql, /'shortages'/);
  assert.match(sql, /'scheduled_count'/);
  assert.match(sql, /'required_count'/);
});

test('MGR-02 exposes only the scoped summary RPC to authenticated users', () => {
  assert.match(sql, /revoke all on function public\.timefit_user_mobile_manager_staffing_summary\(uuid\) from public/);
  assert.match(sql, /grant execute on function public\.timefit_user_mobile_manager_staffing_summary\(uuid\) to authenticated/);
});
