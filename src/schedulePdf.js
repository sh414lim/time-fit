const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const safeColor = value => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#8B95A1';
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

export function openSchedulePrintView({ rangeRows, rangeFrom, rangeTo, weekdays }) {
  const dates = [];
  for (const cursor = dateFromKey(rangeFrom), end = dateFromKey(rangeTo); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(dateKey(cursor));
  }
  const weeks = [];
  for (let index = 0; index < dates.length; index += 7) weeks.push(dates.slice(index, index + 7));
  const people = [...new Map(rangeRows.map(({ row }) => [row[4] || row[0], {
    id: row[4] || row[0], name: row[0], team: row[5] || '미분류', color: safeColor(row[6]), sortOrder: Number(row[9]) || 0,
  }])).values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
  const rowMap = new Map(rangeRows.map(({ date, row }) => [`${row[4] || row[0]}:${date}`, row]));
  const sections = weeks.map((week, weekIndex) => {
    const head = week.map(date => {
      const day = dateFromKey(date);
      const weekend = day.getDay() === 0 ? 'sun' : day.getDay() === 6 ? 'sat' : '';
      return `<th class="${weekend}"><span>${weekdays[day.getDay()]}</span><b>${Number(date.slice(8))}</b></th>`;
    }).join('');
    const rows = people.map(person => {
      const cells = week.map(date => {
        const row = rowMap.get(`${person.id}:${date}`);
        if (!row) return '<td class="empty"><span>—</span></td>';
        if (row[1] === '휴무') return '<td class="off"><strong>휴무</strong></td>';
        const status = row[8] && row[8] !== 'approved'
          ? `<em>${row[8] === 'pending' ? '승인 대기' : '반려'}</em>` : '';
        return `<td class="work" style="--team:${person.color}"><strong>${escapeHtml(displayShiftName(row))}</strong><b>${escapeHtml(String(row[1] || '').replace(' – ', ' ~ '))}</b>${Number(row[7]) > 0 ? `<small>휴게 ${escapeHtml(minutesLabel(row[7]))}</small>` : ''}${status}</td>`;
      }).join('');
      return `<tr><th class="person"><i style="background:${person.color}"></i><div><b>${escapeHtml(person.name)}</b><span>${escapeHtml(person.team)}</span></div></th>${cells}</tr>`;
    }).join('');
    return `<section class="week"><div class="week-title"><div><span>WEEK ${weekIndex + 1}</span><b>${escapeHtml(week[0])} — ${escapeHtml(week.at(-1))}</b></div><small>근무 ${week.reduce((sum, date) => sum + rangeRows.filter(item => item.date === date && item.row[1] !== '휴무').length, 0)}건 · 휴무 ${week.reduce((sum, date) => sum + rangeRows.filter(item => item.date === date && item.row[1] === '휴무').length, 0)}건</small></div><table><thead><tr><th class="person-head">직원 / 구분</th>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>근무표_${escapeHtml(rangeFrom)}_${escapeHtml(rangeTo)}</title><style>
    @page{size:A4 landscape;margin:6mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{margin:0;background:#edf2f8;color:#191f28;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}.content{padding:18px 24px 80px}.week{max-width:1480px;margin:0 auto 18px;padding:18px;border:1px solid #aeb7c2;border-radius:18px;background:#fff;box-shadow:0 5px 16px rgba(27,43,65,.06);break-inside:avoid;page-break-after:always}.week:last-child{page-break-after:auto}.week-title{display:flex;align-items:end;justify-content:space-between;margin-bottom:12px}.week-title>div span{display:block;color:#1769d2;font-size:9px;font-weight:900;letter-spacing:1.5px}.week-title>div b{display:block;margin-top:3px;font-size:16px}.week-title small{color:#4e5968;font-size:10px}table{width:100%;border-spacing:3px;table-layout:fixed}th,td{border:1px solid #aeb7c2;border-radius:8px}thead th{height:42px;background:#e9edf2;color:#333d4b;font-size:10px}.person-head{width:128px;text-align:left;padding-left:12px}.sun{color:#dc3545}.sat{color:#1769d2}thead th span,thead th b{display:block}thead th b{margin-top:2px;font-size:15px}tbody .person{height:68px;padding:8px 10px;background:#f0f3f6;text-align:left}.person{display:flex;align-items:center;gap:8px}.person i{width:9px;height:38px;border-radius:9px}.person div b,.person div span{display:block}.person div b{font-size:12px}.person div span{margin-top:4px;color:#4e5968;font-size:9px}td{height:68px;padding:6px;text-align:center;vertical-align:middle}.work{border:1.5px solid color-mix(in srgb,var(--team) 72%,#52606d);border-top:4px solid var(--team);background:color-mix(in srgb,var(--team) 12%,white)}.work strong,.work b,.work small,.work em{display:block}.work strong{font-size:10px}.work b{margin-top:5px;font-size:10px}.work small{margin-top:3px;color:#4e5968;font-size:8px}.work em{margin-top:3px;color:#d92d3c;font-size:7px;font-style:normal}.off{border-color:#929ca8;background:#dfe3e8;color:#333d4b}.off strong{font-size:11px}.empty{border:1px dashed #aeb7c2;background:#fafbfc;color:#7b8794;font-size:11px}.print{position:fixed;right:24px;bottom:22px;padding:13px 18px;border:0;border-radius:12px;background:#3182f6;color:#fff;box-shadow:0 8px 24px rgba(49,130,246,.3);font-size:13px;font-weight:800;cursor:pointer}@media print{html,body{width:100%;background:#fff}.content{padding:0}.week{width:100%;max-width:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;page-break-after:always}.week:last-child{page-break-after:auto}.print{display:none}}
  </style></head><body><main class="content">${sections}</main><button class="print" onclick="window.print()">PDF 저장 · 인쇄</button></body></html>`);
  popup.document.close();
  return true;
}
