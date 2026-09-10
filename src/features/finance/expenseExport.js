const escapeCsv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;

export function expenseLedgerCsv(items = []) {
  const header = ['원장 ID','거래일','사용처','공급가액','부가세','총금액','분류','지출 사유','담당자','소속','상태','영수증','원천'];
  const rows = items.map(item => [item.ledger_entry_id,item.transaction_date,item.merchant_name,item.supply_amount,item.vat_amount,item.total_amount,item.category,item.reason,item.staff?.display_name,item.staff?.department,item.status,item.sources?.some(source => source.source_type === 'receipt') ? '있음' : '없음',(item.sources || []).map(source => source.source_type).join('|')]);
  return `\uFEFF${[header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n')}`;
}

export function downloadExpenseLedgerCsv(items, month) {
  const blob = new Blob([expenseLedgerCsv(items)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `timefit-expense-ledger-${month}.csv`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
