import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('별도 직원 순서 섹션 없이 직원 목록 행에서 순서를 변경한다', () => {
  assert.doesNotMatch(main, /function EmployeeOrderPanel/);
  assert.doesNotMatch(main, /부서별 직원 표시 순서/);
  assert.match(main, /className="employee-order-actions"/);
  assert.match(main, /onReorder\(reorderStaffWithinType\(employees, movedId, targetId\)\)/);
});

test('직원 행의 위아래 이동 버튼은 모바일에서도 표시된다', () => {
  assert.match(styles, /\.employee-order-actions\{display:flex/);
  assert.match(styles, /\.employee-row \.employee-order-actions \.outline\{display:grid\}/);
});
