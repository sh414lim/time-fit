import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStaffByType } from '../src/lib/staffGrouping.js';

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
