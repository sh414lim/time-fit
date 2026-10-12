import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261010000100_tablet_static_attendance_qr.sql', import.meta.url), 'utf8');
const app = readFileSync(new URL('../tablet_app/lib/main.dart', import.meta.url), 'utf8');

test('tablet QR access is scoped to an active device and remains immutable', () => {
  assert.match(migration, /token_hash\s*=\s*encode\(extensions\.digest\(trim\(p_device_token\)/);
  assert.match(migration, /status\s*=\s*'active'/);
  assert.match(migration, /expires_at\s*>\s*v_now/);
  assert.match(migration, /v_device\.organization_id/);
  assert.match(migration, /if v_static\.organization_id is null then/);
  assert.doesNotMatch(migration, /p_regenerate/);
  assert.match(migration, /to anon, authenticated/);
});

test('tablet UI exposes a QR tab using the same mobile deep link contract', () => {
  assert.match(app, /출퇴근 QR/);
  assert.match(app, /timefit_user_tablet_static_attendance_qr/);
  assert.match(app, /https:\/\/timefit-mobile\.vercel\.app\//);
  assert.match(app, /fragment:\s*'attendance'/);
  assert.match(app, /한 번 발급된 QR은 자동으로 바뀌지 않아요/);
});
