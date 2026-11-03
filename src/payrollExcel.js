const payLabels = { hourly: '시급제', daily: '일급제', monthly: '월급제', annual: '연봉제' };
const payOrder = ['hourly', 'daily', 'monthly', 'annual'];
const moneyFormat = '#,##0"원";[Red]-#,##0"원"';

function styleTitle(sheet, lastColumn) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell(1, 1).font = { size: 18, bold: true, color: { argb: 'FF172033' } };
  sheet.getRow(1).height = 30;
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3182F6' } };
  row.alignment = { vertical: 'middle' };
  row.height = 24;
}

export async function buildPayrollWorkbook({ rows = [], month, savedDraft = false }) {
  const module = await import('exceljs');
  const ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TimeFit';
  workbook.created = new Date();
  const groups = payOrder.map(type => ({ type, label: payLabels[type], rows: rows.filter(row => row.payType === type) })).filter(group => group.rows.length);
  const summary = workbook.addWorksheet('급여 요약', { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
  summary.columns = [{ width: 18 }, { width: 14 }, { width: 22 }, { width: 44 }];
  summary.addRow([`${month} 급여 초안`]);
  styleTitle(summary, 4);
  summary.addRow([savedDraft ? '저장된 세전 스냅샷' : '현재 세전 예상액']);
  summary.mergeCells('A2:D2');
  summary.getCell('A2').font = { color: { argb: 'FF64748B' } };
  summary.addRow([]);
  const total = rows.reduce((sum, row) => sum + Number(row.estimatedTotal || 0), 0);
  summary.addRow(['전체 합계', rows.length, total, '급여 형태별 시트에서 직원 상세를 확인하세요.']);
  summary.getCell('C4').numFmt = moneyFormat;
  summary.getRow(4).font = { bold: true };
  const header = summary.addRow(['급여 형태', '인원', '유형별 합계', '구성']);
  styleHeader(header);
  groups.forEach(group => {
    const groupTotal = group.rows.reduce((sum, row) => sum + Number(row.estimatedTotal || 0), 0);
    const row = summary.addRow([group.label, group.rows.length, groupTotal, group.rows.map(item => item.name).join(', ')]);
    row.getCell(3).numFmt = moneyFormat;
  });
  groups.forEach(group => {
    const sheet = workbook.addWorksheet(group.label, { views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    sheet.columns = [{ width: 18 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 15 }, { width: 18 }];
    sheet.addRow([`${month} ${group.label} 급여 초안`]);
    styleTitle(sheet, 7);
    const groupTotal = group.rows.reduce((sum, row) => sum + Number(row.estimatedTotal || 0), 0);
    sheet.addRow([`${group.rows.length}명 · 유형별 합계`, groupTotal]);
    sheet.getCell('B2').numFmt = moneyFormat;
    sheet.getRow(2).font = { bold: true, color: { argb: 'FF1D4ED8' } };
    const columns = sheet.addRow(['직원', '급여 형태', '적용 단가', '실근무시간', '완료 근무일', '승인 휴가', '급여 초안']);
    styleHeader(columns);
    group.rows.forEach(item => {
      const hours = Math.floor(Number(item.workedMinutes || 0) / 60);
      const minutes = Number(item.workedMinutes || 0) % 60;
      const row = sheet.addRow([item.name, group.label, Math.round(Number(item.rate || 0)), `${hours}시간 ${minutes}분`, Number(item.completedDays || 0), Number(item.leaveDays || 0), Math.round(Number(item.estimatedTotal || 0))]);
      row.getCell(3).numFmt = moneyFormat;
      row.getCell(7).numFmt = moneyFormat;
    });
    const totalRow = sheet.addRow(['소계', '', '', '', '', group.rows.length, groupTotal]);
    totalRow.font = { bold: true };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    totalRow.getCell(7).numFmt = moneyFormat;
    sheet.autoFilter = { from: 'A3', to: 'G3' };
  });
  return workbook;
}

export async function downloadPayrollWorkbook(input) {
  const workbook = await buildPayrollWorkbook(input);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `timefit-payroll-${input.month}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
