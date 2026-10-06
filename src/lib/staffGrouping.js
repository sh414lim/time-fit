export function staffTypeLabel(value) {
  const label = String(value || '').trim();
  return label || '미분류';
}

export function groupStaffByType(items, selectType = item => item.team, selectOrder = () => Number.MAX_SAFE_INTEGER) {
  const groups = new Map();
  for (const [index, item] of (items || []).entries()) {
    const type = staffTypeLabel(selectType(item));
    const rawOrder = Number(selectOrder(item)); const order = Number.isFinite(rawOrder) ? rawOrder : Number.MAX_SAFE_INTEGER;
    if (!groups.has(type)) groups.set(type, { type, staff: [], order, index });
    const group = groups.get(type);
    group.staff.push(item);
    group.order = Math.min(group.order, order);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.index - b.index).map(({ type, staff }) => ({ type, staff }));
}

export function reorderStaffWithinType(items, movedId, targetId, selectType = item => item.team, selectOrder = item => item.categorySortOrder) {
  const groups = groupStaffByType(items, selectType, selectOrder);
  const group = groups.find(candidate => candidate.staff.some(item => item.id === movedId));
  if (!group || !group.staff.some(item => item.id === targetId)) return groups.flatMap(candidate => candidate.staff.map(item => item.id));
  const from = group.staff.findIndex(item => item.id === movedId); const to = group.staff.findIndex(item => item.id === targetId);
  if (from === to) return groups.flatMap(candidate => candidate.staff.map(item => item.id));
  const [moved] = group.staff.splice(from, 1); group.staff.splice(to, 0, moved);
  return groups.flatMap(candidate => candidate.staff.map(item => item.id));
}
