import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStaffByType, reorderStaffWithinType } from '../src/lib/staffGrouping.js';

test('직원은 등록 순서를 유지하며 근무 구분별로 묶인다', () => {
  const groups = groupStaffByType([
    { id: 'a', team: '풀타임' },
    { id: 'b', team: '파트타임' },
    { id: 'c', team: '풀타임' },
    { id: 'd', team: '' },
  ]);
  assert.deepEqual(groups.map(group => [group.type, group.staff.map(item => item.id)]), [
    ['풀타임', ['a', 'c']],
    ['파트타임', ['b']],
    ['미분류', ['d']],
  ]);
});

test('부서 순서를 우선하고 직원은 같은 부서 안에서만 이동한다', () => {
  const staff = [
    { id: 'hall-1', team: '홀', categorySortOrder: 2 },
    { id: 'kitchen-1', team: '주방', categorySortOrder: 1 },
    { id: 'kitchen-2', team: '주방', categorySortOrder: 1 },
  ];
  assert.deepEqual(groupStaffByType(staff, item => item.team, item => item.categorySortOrder).map(group => group.type), ['주방', '홀']);
  assert.deepEqual(reorderStaffWithinType(staff, 'kitchen-2', 'kitchen-1'), ['kitchen-2', 'kitchen-1', 'hall-1']);
  assert.deepEqual(reorderStaffWithinType(staff, 'hall-1', 'kitchen-1'), ['kitchen-1', 'kitchen-2', 'hall-1']);
});
