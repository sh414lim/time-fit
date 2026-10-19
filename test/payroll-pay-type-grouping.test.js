import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/staffGrouping.css', import.meta.url), 'utf8');

test('급여 초안 직원을 급여 형태별 고정 순서로 구분한다', () => {
  assert.match(main, /\["hourly", "시급제"\]/);
  assert.match(main, /\["daily", "일급제"\]/);
  assert.match(main, /\["monthly", "월급제"\]/);
  assert.match(main, /\["annual", "연봉제"\]/);
  assert.match(main, /rows\.filter\(\(row\) => row\.payType === payType\)/);
  assert.match(main, /payrollGroups\.map\(\(group\) =>/);
});

test('급여 형태 머리글에 인원수와 합계를 표시한다', () => {
  assert.match(main, /group\.staff\.length\}명 · \{formatMoney\(group\.total\)\}/);
  assert.match(styles, /\.staff-type-group \.salary-row:first-of-type/);
});
