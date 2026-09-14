const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const EMPLOYEE_COLORS = ['#2563EB', '#DC2626', '#059669', '#7C3AED', '#D97706', '#0891B2', '#DB2777', '#4F46E5', '#65A30D', '#EA580C', '#0F766E', '#9333EA', '#BE123C', '#0369A1', '#A16207', '#475569'];
const SHIFT_COLORS = [
  ['오픈 근무', '#2563EB'], ['오전 근무', '#0EA5E9'], ['풀타임 근무', '#0F9F8F'],
  ['일반 근무', '#16A34A'], ['오후 근무', '#F97316'], ['마감 근무', '#7C3AED'], ['휴무 · 연차', '#64748B'],
];
const tintColor = (hex, whiteRatio = 0.84) => {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${channels.map(channel => Math.round(channel * (1 - whiteRatio) + 255 * whiteRatio)).join(',')})`;
};
const dateFromKey = key => new Date(`${key}T12:00:00`);
const dateKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
const minutesLabel = value => {
  const minutes = Math.max(0, Number(value) || 0);
  if (!minutes) return '';
  return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
};
const displayShiftName = row => {
  const label = String(row[2] || '').trim().replace(/^[A-Z](?:\/[A-Z])?\s*[·\-:]\s*/i, '');
  if (label && !/^[A-Z](?:\/[A-Z])?$/i.test(label)) return label;
  const [start, end] = String(row[1] || '').split(' – ');
  if (start && end && Number(start.slice(0, 2)) >= 12) return '오후 근무';
  if (start && end && Number(end.slice(0, 2)) <= 13) return '오전 근무';
  return '근무';
};
const safeHexColor = value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : null;
const shiftColor = (row, customColors = {}) => {
  const name = `${row?.[1] || ''} ${displayShiftName(row || [])}`;
  const labels = [displayShiftName(row || []), row?.[2], row?.[1]].filter(Boolean).map(value => String(value).trim());
  const normalizedLabels = labels.flatMap(label => [label.replace(/\s/g, ''), label.replace(/\s*근무$/g, '').replace(/\s/g, '')]);
  const configuredEntry = Object.entries(customColors).find(([label]) => {
    const normalized = String(label).replace(/\s/g, '');
    const withoutWork = String(label).replace(/\s*근무$/g, '').replace(/\s/g, '');
    return normalizedLabels.includes(normalized) || normalizedLabels.includes(withoutWork);
  });
  const configured = safeHexColor(configuredEntry?.[1]);
  if (configured) return configured;
  if (/휴무|연차/.test(name)) return SHIFT_COLORS[6][1];
  if (/오픈/.test(name)) return SHIFT_COLORS[0][1];
  if (/오전/.test(name)) return SHIFT_COLORS[1][1];
  if (/오후/.test(name)) return SHIFT_COLORS[4][1];
  if (/마감/.test(name)) return SHIFT_COLORS[5][1];
  if (/풀타임|풀 타임|full.?time/i.test(name)) return SHIFT_COLORS[2][1];
  return SHIFT_COLORS[3][1];
};

export function openSchedulePrintView({ rangeRows, rangeFrom, rangeTo, weekdays, shiftTypeColors = {} }) {
  const dates = [];
  for (const cursor = dateFromKey(rangeFrom), end = dateFromKey(rangeTo); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(dateKey(cursor));
  }
  const weeks = [];
  for (let index = 0; index < dates.length; index += 7) weeks.push(dates.slice(index, index + 7));
  const people = [...new Map(rangeRows.map(({ row }) => [row[4] || row[0], {
    id: row[4] || row[0], name: row[0], team: row[5] || '미분류', sortOrder: Number(row[9]) || 0,
  }])).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'))
    .map((person, index) => ({ ...person, employeeColor: EMPLOYEE_COLORS[index % EMPLOYEE_COLORS.length] }));
  const rowMap = new Map(rangeRows.map(({ date, row }) => [`${row[4] || row[0]}:${date}`, row]));
  const sections = weeks.map((week, weekIndex) => {
    const head = week.map(date => {
      const day = dateFromKey(date);
      const weekend = day.getDay() === 0 ? 'sun' : day.getDay() === 6 ? 'sat' : '';
      return `<th class="${weekend}"><span>${weekdays[day.getDay()]}</span><b>${Number(date.slice(8))}</b></th>`;
    }).join('');
    const rows = people.map((person, personIndex) => {
      const cells = week.map(date => {
        const row = rowMap.get(`${person.id}:${date}`);
        if (!row) return '<td class="empty"><span>—</span></td>';
        if (row[1] === '휴무' || row[1] === '연차') {
          const isLeave = row[1] === '연차';
          const color = shiftColor(row, shiftTypeColors);
          return `<td class="${isLeave ? 'leave' : 'off'}" style="--employee-soft:${tintColor(person.employeeColor, .48)};--shift:${color};background:${tintColor(color, .9)}"><strong>${escapeHtml(row[1])}</strong></td>`;
        }
        const status = row[8] && row[8] !== 'approved'
          ? `<em>${row[8] === 'pending' ? '승인 대기' : '반려'}</em>` : '';
        const color = shiftColor(row, shiftTypeColors);
        return `<td class="work" style="--employee-soft:${tintColor(person.employeeColor, .48)};--shift:${color};background:${tintColor(color, .9)}"><strong>${escapeHtml(displayShiftName(row))}</strong><b>${escapeHtml(String(row[1] || '').replace(' – ', ' ~ '))}</b>${Number(row[7]) > 0 ? `<small>휴게 ${escapeHtml(minutesLabel(row[7]))}</small>` : ''}${status}</td>`;
      }).join('');
      return `<tr><th class="person" style="--employee:${person.employeeColor};--employee-bg:${tintColor(person.employeeColor, .94)}"><i></i><span class="person-number">${personIndex + 1}</span><div><b>${escapeHtml(person.name)}</b><span>${escapeHtml(person.team)}</span></div></th>${cells}</tr>`;
    }).join('');
    const configuredTypes = [...new Set(rangeRows.map(({ row }) => row[1] === '휴무' || row[1] === '연차' ? row[1] : displayShiftName(row)).filter(Boolean))];
    const legendItems = configuredTypes.length ? configuredTypes.map(label => [label, shiftColor(['', '', label], shiftTypeColors)]) : SHIFT_COLORS.slice(0, 6);
    const legend = legendItems.map(([label, color]) => `<span><i style="background:${color}"></i>${escapeHtml(label)}</span>`).join('');
    return `<section class="week"><div class="week-title"><div><span>WEEK ${weekIndex + 1}</span><b>${escapeHtml(week[0])} — ${escapeHtml(week.at(-1))}</b></div><small>근무 ${week.reduce((sum, date) => sum + rangeRows.filter(item => item.date === date && item.row[1] !== '휴무' && item.row[1] !== '연차').length, 0)}건 · 휴무 ${week.reduce((sum, date) => sum + rangeRows.filter(item => item.date === date && (item.row[1] === '휴무' || item.row[1] === '연차')).length, 0)}건</small></div><div class="shift-legend"><b>근무 색상</b>${legend}<em>직원 색상은 이름 바와 얇은 외곽선으로 표시</em></div><table><thead><tr><th class="person-head">번호 · 직원 / 구분</th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>근무표_${escapeHtml(rangeFrom)}_${escapeHtml(rangeTo)}</title><style>
    @page{size:A4 landscape;margin:6mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{margin:0;background:#edf2f8;color:#191f28;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}.content{padding:18px 24px 80px}.week{max-width:1480px;margin:0 auto 18px;padding:18px;border:1px solid #aeb7c2;border-radius:18px;background:#fff;box-shadow:0 5px 16px rgba(27,43,65,.06);break-inside:avoid;page-break-after:always}.week:last-child{page-break-after:auto}.week-title{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.week-title>div span{display:block;color:#1769d2;font-size:9px;font-weight:900;letter-spacing:1.5px}.week-title>div b{display:block;margin-top:3px;font-size:16px}.week-title small{color:#4e5968;font-size:10px}table{width:100%;border-spacing:3px;table-layout:fixed}th,td{border:1px solid #aeb7c2;border-radius:8px}thead th{height:42px;background:#e9edf2;color:#333d4b;font-size:10px}.person-head{width:128px;text-align:left;padding-left:12px}.sun{color:#dc3545}.sat{color:#1769d2}thead th span,thead th b{display:block}thead th b{margin-top:2px;font-size:15px}tbody .person{height:68px;padding:8px 10px;background:#f0f3f6;text-align:left}.person{display:flex;align-items:center;gap:8px}.person i{width:9px;height:38px;border-radius:9px}.person div b,.person div span{display:block}.person div b{font-size:12px}.person div span{margin-top:4px;color:#4e5968;font-size:9px}td{height:68px;padding:6px;text-align:center;vertical-align:middle}.work{border:1.5px solid color-mix(in srgb,var(--team) 72%,#52606d);border-top:4px solid var(--team);background:color-mix(in srgb,var(--team) 12%,white)}.work strong,.work b,.work small,.work em{display:block}.work strong{font-size:10px}.work b{margin-top:5px;font-size:10px}.work small{margin-top:3px;color:#4e5968;font-size:8px}.work em{margin-top:3px;color:#d92d3c;font-size:7px;font-style:normal}.off{border-color:#929ca8;background:#dfe3e8;color:#333d4b}.off strong{font-size:11px}.empty{border:1px dashed #aeb7c2;background:#fafbfc;color:#7b8794;font-size:11px}.print{position:fixed;right:24px;bottom:22px;padding:13px 18px;border:0;border-radius:12px;background:#3182f6;color:#fff;box-shadow:0 8px 24px rgba(49,130,246,.3);font-size:13px;font-weight:800;cursor:pointer}@media print{html,body{width:100%;background:#fff}.content{padding:0}.week{width:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;page-break-after:always}.week:last-child{page-break-after:auto}.print{display:none}}
    .shift-legend{display:flex;align-items:center;gap:9px;margin:-3px 0 8px;padding:6px 9px;border-radius:8px;background:#f8fafc;color:#475569;font-size:7.5px}.shift-legend>b{margin-right:2px;font-size:8px}.shift-legend span{display:inline-flex;align-items:center;gap:3px}.shift-legend span i{width:8px;height:8px;border-radius:3px}.shift-legend em{margin-left:auto;color:#64748b;font-style:normal}.shift-legend em:before{content:'';display:inline-block;width:13px;height:8px;margin-right:4px;border:2px solid #2563eb;border-radius:3px;vertical-align:-1px;background:#fff}tbody .person{background:color-mix(in srgb,var(--employee) 7%,white);border:2px solid var(--employee)}.person i{background:var(--employee)}.work{border:2px solid var(--employee);border-top:5px solid var(--shift);background:color-mix(in srgb,var(--shift) 16%,white);box-shadow:inset 0 2px 0 color-mix(in srgb,var(--shift) 30%,transparent)}.off{border:2px solid var(--employee);border-top:5px solid var(--shift);background:color-mix(in srgb,var(--shift) 11%,white)}
    table{border-spacing:2px}th,td{border-radius:6px}.person-head{width:140px}tbody .person{padding:7px 8px;background:var(--employee-bg);border:1px solid #cbd5e1}.person i{width:7px;height:42px}.person-number{min-width:19px;color:#64748b;font-size:9px;font-weight:800;text-align:center}.work{border:1px solid var(--employee-soft);border-top:4px solid var(--shift);box-shadow:none}.off,.leave{border:1px solid var(--employee-soft);border-top:4px solid var(--shift);color:#333d4b}.off strong,.leave strong{font-size:11px}.empty{border-color:#cbd2da;background:#fbfcfd;color:#8b95a1}.shift-legend em:before{border-width:1px;border-color:#8da7cb}
  </style></head><body><main class="content">${sections}</main><button class="print" onclick="window.print()">PDF 저장 · 인쇄</button></body></html>`);
  popup.document.close();
  return true;
}
