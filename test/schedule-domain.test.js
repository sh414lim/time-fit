import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulePeople } from '../src/scheduleDomain.js';

test('근무 일정은 소속과 근무자 이름으로 변환한다', () => {
  const entries = [
    ['김나희', '09:30 – 21:30', '일반 근무', 'schedule-1', 'staff-1'],
    ['최정수', '16:30 – 21:30', '오후 근무', 'schedule-2', 'staff-2', '홀서비스팀', '#7C3AED'],
  ];
  const employees = [
    { id: 'staff-1', name: '김나희', team: '운영팀', categoryColor: '#2563EB' },
    { id: 'staff-2', name: '최정수', team: '기존 소속' },
  ];

  assert.deepEqual(schedulePeople(entries, employees), [
    { id: 'schedule-1', staffId: 'staff-1', name: '김나희', team: '운영팀', color: '#2563EB' },
    { id: 'schedule-2', staffId: 'staff-2', name: '최정수', team: '홀서비스팀', color: '#7C3AED' },
  ]);
});

test('휴무와 연차는 근무자 이름 목록에서 제외한다', () => {
  const entries = [
    ['김나희', '휴무', '휴무', 'schedule-1', 'staff-1'],
    ['최정수', '연차', '연차', 'schedule-2', 'staff-2'],
    ['최병주', '09:30 – 21:30', '일반 근무', 'schedule-3', 'staff-3'],
  ];

  assert.deepEqual(schedulePeople(entries), [
    { id: 'schedule-3', staffId: 'staff-3', name: '최병주', team: '미분류', color: '#8B95A1' },
  ]);
});
