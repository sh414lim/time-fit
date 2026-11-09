import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../supabase/migrations/20261018000300_short_term_worker_isolated_storage.sql', import.meta.url),
  'utf8',
);

test('short-term workers are isolated from ordinary staff registration', () => {
  assert.match(sql, /create table if not exists public\.timefit_user_short_term_workers/);
  assert.match(sql, /create table if not exists public\.timefit_user_short_term_attendance_records/);
  assert.doesNotMatch(sql, /insert into public\.timefit_user_staff/);
  assert.doesNotMatch(sql, /insert into public\.timefit_user_attendance_records/);
  assert.match(sql, /isolated from ordinary staff registration/);
});

test('resident identity is stored only as ciphertext, a mask, and a keyed HMAC', () => {
  assert.match(sql, /encrypted_resident_registration_number/);
  assert.match(sql, /resident_registration_mask/);
  assert.match(sql, /resident_registration_hmac/);
  assert.match(sql, /plaintext never reaches PostgreSQL/);
  assert.doesNotMatch(sql, /p_resident_registration_number/i);
});

test('tablet writes are service-role only and bound to active devices', () => {
  assert.match(sql, /device\.token_hash = encode\(extensions\.digest/);
  assert.match(sql, /device\.status = 'active'/);
  assert.match(sql, /device\.expires_at > v_now/);
  assert.match(sql, /revoke all on function public\.timefit_user_daily_worker_check_in[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.timefit_user_daily_worker_check_in[\s\S]+to service_role/);
});

test('attendance requests are serialized, idempotent, and preserve overnight checkout', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /check_in_request_key = p_request_key/);
  assert.match(sql, /attendance\.short_term_worker_id = v_worker\.id/);
  assert.match(sql, /check_out_request_key = p_request_key/);
  assert.match(sql, /interval '18 hours'/);
  assert.match(sql, /daily_worker_already_checked_in/);
  assert.match(sql, /daily_worker_already_checked_out/);
});

test('daily worker writes retain consent and an immutable event trail', () => {
  assert.match(sql, /timefit_user_short_term_privacy_consents/);
  assert.match(sql, /privacy_policy_version/);
  assert.match(sql, /timefit_user_short_term_attendance_events/);
  assert.match(sql, /event_type in \('check_in', 'check_out', 'review_required'\)/);
  assert.match(sql, /unique \(organization_id, request_key\)/);
});

test('device ids cannot be attached across organizations', () => {
  assert.match(sql, /check_in_device_organization_mismatch/);
  assert.match(sql, /check_out_device_organization_mismatch/);
  assert.match(sql, /device\.organization_id = new\.organization_id/);
});
