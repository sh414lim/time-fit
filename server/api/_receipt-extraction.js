const cleanText = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
const cleanDate = value => /^20\d{2}-\d{2}-\d{2}$/.test(value || '') ? value : null;
const cleanTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? value : null;
const cleanAmount = value => Number.isInteger(value) && value >= 0 ? value : null;
const cleanNumber = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const cleanConfidence = value => Math.max(0, Math.min(1, Number(value) || 0));

export const normalizeReceiptItemName = value => String(value || '').trim().toLowerCase()
  .replace(/\b(kg|g|ml|l|ea|개|봉|팩|박스|box)\b/gi, ' $1 ')
  .replace(/[^0-9a-z가-힣]+/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || null;

const cleanLineItems = value => (Array.isArray(value) ? value : []).slice(0, 100).map((item, index) => ({
  lineNumber: index + 1,
  rawText: cleanText(item?.rawText) || cleanText(item?.itemName) || '',
  itemNameRaw: cleanText(item?.itemName),
  itemNameNormalized: normalizeReceiptItemName(item?.itemName),
  quantity: cleanNumber(item?.quantity),
  unit: cleanText(item?.unit)?.slice(0, 30) || null,
  unitPrice: cleanAmount(item?.unitPrice),
  discountAmount: cleanAmount(item?.discountAmount) || 0,
  lineAmount: cleanAmount(item?.lineAmount),
  taxType: ['taxable','tax_free','unknown'].includes(item?.taxType) ? item.taxType : 'unknown',
  confidence: cleanConfidence(item?.confidence),
})).filter(item => item.itemNameRaw || item.lineAmount !== null);

export function validateReceiptExtraction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('receipt_extraction_invalid');
  const result = {
    merchantName: cleanText(value.merchantName), transactionDate: cleanDate(value.transactionDate), transactionTime: cleanTime(value.transactionTime),
    totalAmount: cleanAmount(value.totalAmount), supplyAmount: cleanAmount(value.supplyAmount), vatAmount: cleanAmount(value.vatAmount), taxFreeAmount: cleanAmount(value.taxFreeAmount),
    merchantBusinessNumber: cleanText(value.merchantBusinessNumber), approvalNumber: cleanText(value.approvalNumber),
    cardLast4: /^\d{4}$/.test(value.cardLast4 || '') ? value.cardLast4 : null,
    paymentMethod: ['corporate_card','personal_card','cash','bank_transfer','other'].includes(value.paymentMethod) ? value.paymentMethod : null,
    category: ['재료비','소모품비','교통비','접대비','공과금','임차료','기타'].includes(value.category) ? value.category : null,
    confidence: cleanConfidence(value.confidence),
    fieldConfidence: {
      merchantName: cleanConfidence(value.fieldConfidence?.merchantName ?? value.confidence),
      transactionDate: cleanConfidence(value.fieldConfidence?.transactionDate ?? value.confidence),
      totalAmount: cleanConfidence(value.fieldConfidence?.totalAmount ?? value.confidence),
      paymentMethod: cleanConfidence(value.fieldConfidence?.paymentMethod ?? value.confidence),
    },
    lineItems: cleanLineItems(value.lineItems),
  };
  if (result.supplyAmount !== null && result.vatAmount !== null && result.totalAmount !== null && result.supplyAmount + result.vatAmount + (result.taxFreeAmount || 0) !== result.totalAmount) {
    result.supplyAmount = null; result.vatAmount = null; result.confidence = Math.min(result.confidence, 0.6);
  }
  return result;
}
