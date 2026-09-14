import readXlsxFile from 'read-excel-file';

const normalizedHeader = value => String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
const field = (row, names) => {
  const wanted = names.map(normalizedHeader);
  const key = Object.keys(row).find(candidate => wanted.includes(normalizedHeader(candidate)));
  return key ? row[key] : '';
};
const money = value => {
  if (typeof value === 'number') return value;
  const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const approvedAt = value => {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || '').trim().replace(/\./g, '-').replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
};
const merchantFrom = value => String(value || '').split(/[→←|]/)[0].trim() || String(value || '').trim();

export function normalizeGranterRows(sourceRows) {
  const skipped = { nonCard: 0, invalid: 0 };
  const rows = [];
  sourceRows.forEach((row, index) => {
    const typeText = String(field(row, ['거래구분', '구분', 'type']) || '').trim();
    const usage = String(field(row, ['사용처', '가맹점', '거래처', 'merchant', 'merchantname']) || '').trim();
    // The Granter account export also contains settlement deposits whose
    // merchant text includes a card-company name. Only the transaction type
    // is authoritative for card usage; merchant text must never opt a row in.
    if (!/(체크카드|신용카드|법인카드|카드\s*(승인|취소|환불))/i.test(typeText)) { skipped.nonCard += 1; return; }
    const date = approvedAt(field(row, ['일시', '거래일시', '승인일시', 'date', 'approvedat']));
    const signedAmount = money(field(row, ['금액', '이용금액', '승인금액', 'amount']));
    const accountName = String(field(row, ['계좌이름', '카드이름', '카드명', 'accountname']) || '').trim() || '결제내역 카드';
    const merchantName = merchantFrom(usage);
    if (!date || !signedAmount || !merchantName) { skipped.invalid += 1; return; }
    const last4 = accountName.match(/(\d{4})(?!.*\d)/)?.[1] || '0000';
    const cancellation = /취소|환불|cancel/i.test(typeText) || signedAmount > 0;
    const amount = Math.abs(signedAmount);
    const transactionType = cancellation ? 'cancellation' : 'approval';
    rows.push({
      rowNumber: index + 2,
      approvedAt: date,
      merchantName,
      amount,
      transactionType,
      sourceTransactionId: `granter:${accountName}:${date}:${signedAmount}:${usage}`,
      groupKey: `granter:${accountName}:${date}:${amount}:${merchantName}`,
      accountName,
      last4,
      issuer: accountName.replace(/\d{4}.*$/, '').trim() || '카드',
      category: String(field(row, ['계정과목', '카테고리', 'category']) || '').trim(),
      memo: String(field(row, ['사유', '메모', 'memo']) || '').trim(),
      employee: String(field(row, ['사용직원', '직원', 'employee']) || '').trim(),
      transactionLabel: typeText,
    });
  });
  return { rows, skipped };
}

export async function parseGranterCardFile(file) {
  if (!/\.xlsx$/i.test(file?.name || '')) throw new Error('결제내역 .xlsx 파일만 선택해 주세요.');
  if (Number(file?.size || 0) > 10 * 1024 * 1024) throw new Error('파일은 10MB 이하만 가져올 수 있습니다. 기간을 나눠 내려받아 주세요.');
  const matrix = await readXlsxFile(file);
  const headerIndex = matrix.findIndex(row => row.some(value => normalizedHeader(value) === '일시') && row.some(value => normalizedHeader(value) === '금액'));
  if (headerIndex < 0) throw new Error('결제내역 파일의 일시·금액 헤더를 찾지 못했습니다.');
  if (matrix.length - headerIndex - 1 > 5000) throw new Error('한 번에 5,000건까지 가져올 수 있습니다. 기간을 나눠 내려받아 주세요.');
  const headers = matrix[headerIndex].map(value => String(value || '').trim());
  const objects = matrix.slice(headerIndex + 1).filter(row => row.some(value => value !== '')).map(row => Object.fromEntries(headers.map((header, index) => [header || `column_${index}`, row[index]])));
  return normalizeGranterRows(objects);
}
