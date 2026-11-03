export function staffTypeLabel(value) {
  const label = String(value || "").trim();
  return label || "미분류";
}

export function groupStaffByType(items, selectType = (item) => item.team) {
  const groups = new Map();
  for (const item of items || []) {
    const type = staffTypeLabel(selectType(item));
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(item);
  }
  return [...groups].map(([type, staff]) => ({ type, staff }));
}

const PAY_TYPE_LABELS = {
  hourly: "시급제",
  daily: "일급제",
  monthly: "월급제",
  annual: "연봉제",
};

const PAY_TYPE_ORDER = ["시급제", "일급제", "월급제", "연봉제", "급여 미설정"];

export function payTypeLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "급여 미설정";
  return PAY_TYPE_LABELS[normalized] || normalized;
}

export function groupStaffByPayType(items, selectType = (item) => item.payType || item.pay) {
  return groupStaffByType(items, (item) => payTypeLabel(selectType(item))).sort((a, b) => {
    const aIndex = PAY_TYPE_ORDER.indexOf(a.type);
    const bIndex = PAY_TYPE_ORDER.indexOf(b.type);
    return (aIndex < 0 ? PAY_TYPE_ORDER.length : aIndex) - (bIndex < 0 ? PAY_TYPE_ORDER.length : bIndex)
      || a.type.localeCompare(b.type, "ko");
  });
}

export function groupStaffByPayTypeAndWorkArea(
  items,
  selectPayType = (item) => item.payType || item.pay,
  selectWorkArea = (item) => item.team,
) {
  return groupStaffByPayType(items, selectPayType).map((payGroup) => ({
    ...payGroup,
    workAreas: groupStaffByType(payGroup.staff, selectWorkArea),
  }));
}
