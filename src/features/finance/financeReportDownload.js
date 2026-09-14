import notoSansKrUrl from '../../assets/fonts/NotoSansKR.ttf?url';

const won = value => `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
const filePeriod = report => `${report.from}_${report.to}`;
const reportRows = report => report?.displaySeries || report?.series || [];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function profitChartDataUrl(rows, width = 1200, height = 420) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const padding = { left: 95, right: 30, top: 35, bottom: 55 };
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  const values = rows.map(row => Number(row.operatingProfit || 0));
  const max = Math.max(1, ...values.map(Math.abs));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const zeroY = padding.top + plotHeight / 2;
  context.strokeStyle = '#dbe4f0';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(padding.left, zeroY);
  context.lineTo(width - padding.right, zeroY);
  context.stroke();
  context.fillStyle = '#64748b';
  context.font = '22px sans-serif';
  context.textAlign = 'right';
  context.fillText(`+${won(max)}`, padding.left - 12, padding.top + 8);
  context.fillText('0', padding.left - 12, zeroY + 8);
  context.fillText(`-${won(max)}`, padding.left - 12, height - padding.bottom + 8);
  if (rows.length) {
    context.strokeStyle = '#2f80ed';
    context.lineWidth = 5;
    context.lineJoin = 'round';
    context.beginPath();
    rows.forEach((row, index) => {
      const x = padding.left + (rows.length === 1 ? plotWidth / 2 : index * plotWidth / (rows.length - 1));
      const y = zeroY - Number(row.operatingProfit || 0) / max * (plotHeight / 2);
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
    context.fillStyle = '#334155';
    context.font = '22px sans-serif';
    context.textAlign = 'left';
    context.fillText(rows[0].date, padding.left, height - 15);
    context.textAlign = 'right';
    context.fillText(rows.at(-1).date, width - padding.right, height - 15);
  }
  return canvas.toDataURL('image/png');
}

export async function downloadFinanceReportXlsx({ report, periodType }) {
  const module = await import('exceljs');
  const ExcelJS = module.default || module;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TimeFit';
  workbook.created = new Date();
  const summary = workbook.addWorksheet('손익 요약', { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 23 }, { width: 22 }, { width: 23 }, { width: 22 }, { width: 23 }, { width: 22 }];
  summary.addRow(['TimeFit 운영손익 보고서']);
  summary.mergeCells('A1:F1');
  summary.getCell('A1').font = { size: 20, bold: true, color: { argb: 'FF172033' } };
  summary.getRow(1).height = 34;
  summary.addRow([`${report.from} ~ ${report.to}`, '', '', '', '', '']);
  summary.mergeCells('A2:F2');
  summary.getCell('A2').font = { color: { argb: 'FF64748B' } };
  summary.addRow([]);
  summary.addRow(['순매출', report.totals.netSales, '운영지출', report.totals.operatingExpenses, '인건비', report.totals.laborCost]);
  summary.addRow(['운영순익', report.totals.operatingProfit, '순익률', report.totals.profitMargin === null ? null : report.totals.profitMargin / 100, '미증빙 카드 지출', report.totals.provisionalCardExpenses || 0]);
  ['A4','C4','E4','A5','C5','E5'].forEach(cell => {
    summary.getCell(cell).font = { bold: true, color: { argb: 'FF475569' } };
    summary.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  });
  ['B4','D4','F4','B5','F5'].forEach(cell => {
    summary.getCell(cell).numFmt = '#,##0"원";[Red]-#,##0"원"';
    summary.getCell(cell).font = { bold: true };
  });
  summary.getCell('D5').numFmt = '0.0%';
  summary.addRow([]);
  summary.addRow(['증빙률', (report.completeness?.evidenceRate || 0) / 100, '미대사 카드', report.completeness?.unresolvedCardTransactions || 0, '결산 상태', report.audit?.status === 'closed' ? '확정' : '미확정 미리보기']);
  summary.getCell('B7').numFmt = '0.0%';
  const rows = reportRows(report);
  const chartImage = workbook.addImage({ base64: profitChartDataUrl(rows), extension: 'png' });
  summary.addImage(chartImage, { tl: { col: 0, row: 8 }, ext: { width: 900, height: 315 } });
  const detail = workbook.addWorksheet('기간별 손익', { views: [{ state: 'frozen', ySplit: 1 }] });
  detail.columns = [
    { header: '기간', key: 'date', width: 16 }, { header: '순매출', key: 'sales', width: 18 },
    { header: '운영지출', key: 'expenses', width: 18 }, { header: '인건비', key: 'labor', width: 18 },
    { header: '운영순익', key: 'profit', width: 18 }, { header: '순익률', key: 'margin', width: 13 },
  ];
  rows.forEach(row => detail.addRow({ date: row.date, sales: row.sales ?? row.netSales, expenses: row.operatingExpenses, labor: row.laborCost, profit: row.operatingProfit, margin: row.sales ? row.operatingProfit / row.sales : null }));
  detail.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  detail.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF26364D' } };
  detail.getRow(1).alignment = { horizontal: 'center' };
  detail.getColumn(1).alignment = { horizontal: 'center' };
  [2,3,4,5].forEach(index => { detail.getColumn(index).numFmt = '#,##0"원";[Red]-#,##0"원"'; });
  detail.getColumn(6).numFmt = '0.0%';
  detail.eachRow((row, index) => {
    if (index > 1 && index % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    row.height = 22;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `timefit-finance-${filePeriod(report)}.xlsx`);
}

export async function downloadFinanceReportPdf({ report, periodType }) {
  const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkitModule.default || fontkitModule);
  const fontBytes = await fetch(notoSansKrUrl).then(response => {
    if (!response.ok) throw new Error('PDF 한글 폰트를 불러오지 못했습니다.');
    return response.arrayBuffer();
  });
  const font = await document.embedFont(fontBytes, { subset: true });
  const pageSize = [841.89, 595.28];
  const rows = reportRows(report);
  const navy = rgb(0.09, 0.13, 0.2); const blue = rgb(0.18, 0.5, 0.93); const gray = rgb(0.4, 0.45, 0.53); const light = rgb(0.92, 0.95, 0.98);
  const text = (page, value, x, y, size = 10, color = navy) => page.drawText(String(value ?? ''), { x, y, size, font, color });
  const page = document.addPage(pageSize);
  text(page, 'TimeFit 운영손익 보고서', 42, 548, 22);
  text(page, `${report.from} ~ ${report.to} · ${periodType}`, 42, 526, 10, gray);
  const metrics = [['순매출',report.totals.netSales],['운영지출',report.totals.operatingExpenses],['인건비',report.totals.laborCost],['운영순익',report.totals.operatingProfit]];
  metrics.forEach(([label,value], index) => {
    const x = 42 + index * 193;
    page.drawRectangle({ x, y: 456, width: 178, height: 54, color: light });
    text(page, label, x + 12, 490, 9, gray);
    text(page, won(value), x + 12, 469, 15);
  });
  text(page, `미증빙 카드 지출 ${won(report.totals.provisionalCardExpenses || 0)} · 증빙률 ${report.completeness?.evidenceRate ?? 0}% · 미대사 카드 ${report.completeness?.unresolvedCardTransactions || 0}건`, 42, 438, 9, gray);
  text(page, '기간별 운영순익 추이', 42, 414, 13);
  const chart = { x: 62, y: 195, width: 730, height: 195 };
  page.drawLine({ start: { x: chart.x, y: chart.y + chart.height / 2 }, end: { x: chart.x + chart.width, y: chart.y + chart.height / 2 }, thickness: 1, color: light });
  const max = Math.max(1, ...rows.map(row => Math.abs(Number(row.operatingProfit || 0))));
  const points = rows.map((row,index) => ({ x: chart.x + (rows.length === 1 ? chart.width / 2 : index * chart.width / (rows.length - 1)), y: chart.y + chart.height / 2 + Number(row.operatingProfit || 0) / max * chart.height * 0.43 }));
  points.slice(1).forEach((point,index) => page.drawLine({ start: points[index], end: point, thickness: 2.2, color: blue }));
  points.forEach(point => page.drawCircle({ x: point.x, y: point.y, size: 2.3, color: blue }));
  text(page, `+${won(max)}`, 42, chart.y + chart.height - 5, 8, gray);
  text(page, '0', 42, chart.y + chart.height / 2 - 3, 8, gray);
  text(page, `-${won(max)}`, 42, chart.y, 8, gray);
  if (rows.length) {
    text(page, rows[0].date, chart.x, 178, 8, gray);
    text(page, rows.at(-1).date, chart.x + chart.width - 55, 178, 8, gray);
  }
  text(page, '세부 내역은 다음 페이지에서 확인할 수 있습니다.', 42, 145, 9, gray);
  const columns = [{ label:'기간',x:42 },{ label:'순매출',x:147 },{ label:'운영지출',x:289 },{ label:'인건비',x:431 },{ label:'운영순익',x:573 },{ label:'순익률',x:715 }];
  const perPage = 20;
  for (let offset = 0; offset < rows.length; offset += perPage) {
    const tablePage = document.addPage(pageSize);
    text(tablePage, '기간별 손익표', 42, 548, 18);
    text(tablePage, `${report.from} ~ ${report.to}`, 42, 528, 9, gray);
    tablePage.drawRectangle({ x: 42, y: 492, width: 757, height: 24, color: navy });
    columns.forEach(column => text(tablePage, column.label, column.x + 6, 500, 9, rgb(1,1,1)));
    rows.slice(offset, offset + perPage).forEach((row,index) => {
      const y = 466 - index * 21;
      if (index % 2 === 0) tablePage.drawRectangle({ x:42,y:y-5,width:757,height:21,color:rgb(0.97,0.98,0.99) });
      const margin = row.sales ? `${Math.round(row.operatingProfit / row.sales * 1000) / 10}%` : '-';
      const values = [row.date,won(row.sales ?? row.netSales),won(row.operatingExpenses),won(row.laborCost),won(row.operatingProfit),margin];
      values.forEach((value,columnIndex) => text(tablePage,value,columns[columnIndex].x+6,y,8.5,columnIndex===4&&Number(row.operatingProfit)<0?rgb(0.8,0.12,0.12):navy));
    });
    text(tablePage, `${offset / perPage + 2} / ${Math.ceil(rows.length / perPage) + 1}`, 760, 24, 8, gray);
  }
  const bytes = await document.save();
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `timefit-finance-${filePeriod(report)}.pdf`);
}
