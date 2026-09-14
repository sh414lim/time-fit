export function schedulePeople(entries = [], employees = []) {
  return entries
    .filter(([, time]) => time !== '휴무' && time !== '연차')
    .map(([name, , , scheduleId, staffId, categoryName, categoryColor]) => {
      const employee = employees.find(item => staffId ? item.id === staffId : item.name === name);
      return {
        id: scheduleId || `${staffId || name}:${name}`,
        staffId: staffId || employee?.id,
        name,
        team: categoryName || employee?.team || '미분류',
        color: categoryColor || employee?.categoryColor || '#8B95A1',
      };
    });
}
