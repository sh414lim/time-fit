import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('영수증 원본은 인증된 Google Drive 함수로 업로드된다', async () => {
  const source = await read('supabase/functions/upload-receipt-drive/index.ts');
  assert.match(source, /admin\.auth\.getUser/);
  assert.match(source, /timefit_user_memberships/);
  assert.match(source, /www\.googleapis\.com\/upload\/drive\/v3\/files/);
  assert.match(source, /webViewLink/);
  assert.match(source, /GOOGLE_DRIVE_FOLDER_ID/);
  assert.match(source, /GOOGLE_DRIVE_REFRESH_TOKEN/);
  assert.match(source, /supportsAllDrives=true/);
});

test('관리자와 직원 영수증 UI는 원본 등록 후 분석·지출·검토 처리를 시작한다', async () => {
  const [main, employee] = await Promise.all([read('src/main.jsx'), read('src/features/finance/EmployeeReceiptSubmission.jsx')]);
  const manager = main.slice(main.indexOf('function ManagerReceiptUpload'), main.indexOf('function ExpenseWorkspace'));
  assert.match(manager, /uploadReceiptToGoogleDrive/);
  assert.match(manager, /createReceiptSubmission/);
  assert.match(manager, /processReceiptDocument/);
  assert.match(manager, /source: "manager_web"/);
  assert.match(manager, /Promise\.allSettled/);
  assert.match(employee, /uploadReceiptToGoogleDrive/);
  assert.match(employee, /createReceiptSubmission/);
  assert.match(employee, /processReceiptDocument/);
  assert.match(employee, /confirmReceiptSubmission/);
  assert.match(employee, /loadMyReceiptDocuments/);
  assert.match(employee, /source: 'employee_web'/);
  assert.match(employee, /Promise\.allSettled/);
  assert.match(main, /\["evidence", "증빙 검토"\]/);
  assert.match(main, /<ExpenseReviewQueue/);
});

test('Drive 업로드 링크는 페이지 이동과 새로고침 후에도 복원된다', async () => {
  const [client, main, employee] = await Promise.all([read('src/lib/supabase.js'), read('src/main.jsx'), read('src/features/finance/EmployeeReceiptSubmission.jsx')]);
  assert.match(client, /timefit:drive-receipts:/);
  assert.match(client, /localStorage\.setItem/);
  assert.match(client, /uploadedBy: userId/);
  assert.match(client, /currentUserOnly/);
  assert.match(client, /export async function loadDriveReceiptUploads/);
  assert.match(main, /loadDriveReceiptUploads\(organizationId\)/);
  assert.match(employee, /loadDriveReceiptUploads\(organizationId, \{ currentUserOnly: true \}\)/);
  assert.match(employee, /const formElement = event\.currentTarget/);
  assert.match(employee, /const form = new FormData\(formElement\)/);
});

test('Vercel Pages API는 AX 처리를 응답 전에 완료해 작업이 queued에 남지 않는다', async () => {
  const source = await read('server/api/receipt-process.js');
  assert.match(source, /process\.env\.VERCEL === '1'/);
  assert.match(source, /if \(process\.env\.VERCEL === '1'\) await task\(\)/);
  assert.match(source, /await dispatchReceiptRun\(\{ organizationId, documentId, queued \}\)/);
  assert.doesNotMatch(source, /scheduleBackground\(\(\) => processReceiptRun\(\{ organizationId, documentId, runId: run\.id \}\)\)/);
});
