import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const comparison = readFileSync(new URL('../src/attendanceComparison.js', import.meta.url), 'utf8');

test('employee detail exposes audited date attendance correction only to attendance managers', () => {
  assert.match(main, /permissions\?\.includes\("attendance\.manage"\)/);
  assert.match(main, /근무시간 수정/);
  assert.match(main, /await revalidateManagementPermission\("attendance\.manage"\)/);
  assert.match(main, /await correctAttendance\(/);
});

test('employee detail correction carries the current attendance version for conflict checks', () => {
  assert.match(comparison, /record,/);
  assert.match(main, /record: row\.record \|\| null/);
  assert.match(main, /attendance_record_changed/);
});

test('employee detail correction requires a reason and a confirmation step', () => {
  assert.match(main, /수정 사유/);
  assert.match(main, /수정 내용 확인/);
  assert.match(main, /근무시간 저장/);
  assert.match(main, /감사 이력/);
});
