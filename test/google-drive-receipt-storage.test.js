import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261007000100_google_drive_receipt_storage.sql', import.meta.url), 'utf8');

test('영수증 대표 문서와 페이지에 Google Drive 저장 정보를 추가한다', () => {
  assert.match(migration, /alter table public\.timefit_user_finance_documents/);
  assert.match(migration, /alter table public\.timefit_user_finance_document_pages/);
  assert.match(migration, /storage_provider text not null default 'supabase'/);
  assert.match(migration, /external_file_id text/);
  assert.match(migration, /external_url text/);
});

test('기존 Supabase 경로와 Google Drive 파일 정보를 모두 검증한다', () => {
  assert.match(migration, /storage_provider in \('supabase','google_drive'\)/);
  assert.match(migration, /storage_provider = 'supabase' and storage_path is not null/);
  assert.match(migration, /storage_provider = 'google_drive'/);
  assert.match(migration, /nullif\(trim\(external_file_id\),''\) is not null/);
  assert.match(migration, /nullif\(trim\(external_url\),''\) is not null/);
});
