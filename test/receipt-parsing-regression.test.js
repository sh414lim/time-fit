import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceiptText, parseVisionResponses} from '../services/timefit-ax/server.mjs';
import {normalizeTimefitAxExtraction} from '../server/api/_timefit-ax.js';
import {receiptValidation} from '../server/domain/receipt-validation.js';

const items = [
  ['알감자', 2, 1800, 3600], ['대추방울토마토/750g', 4, 10500, 42000],
  ['양상추', 2, 2200, 4400], ['적근대', 0.5, 9800, 4900],
  ['치커리', 0.5, 4500, 2250], ['적양파', 2, 1500, 3000],
];
// Manually transcribed values, not a captured production Vision response.
const text = ['거래명세서', '지프레시', '2026-10-01', ...items.map(i => i.join(' ')), '전미수금 7,401,385', '금일매출액 60,150', '총합계 7,461,535'].join('\n');
test('ordinary inline total does not discard preceding items', () => {
  const parsed=parseReceiptText('영수증\n상점\n2026-10-01\n커피 2 4000 8000\n합계 8000원\n카드결제 8000원');
  assert.deepEqual(parsed.lineItems.map(i=>[i.name,i.quantity,i.unitPrice,i.amount]),[['커피',2,4000,8000]]);
});
test('six invoice rows preserve decimal quantities and exclude balances', () => {
  const parsed = parseReceiptText(text);
  assert.equal(parsed.totalAmount, 60150);
  assert.deepEqual(parsed.lineItems.map(i => [i.name, i.quantity, i.unitPrice, i.amount]), items);
  assert.equal(receiptValidation(normalizeTimefitAxExtraction(parsed)).validForManagerReview, true);
});
test('vertical OCR numbers do not turn quantity 2 into amount 2', () => {
  const parsed = parseReceiptText('거래명세서\n지프레시\n2026-10-01\n알감자\n2\n1,800\n3,600\n금일매출액 3,600');
  assert.deepEqual(parsed.lineItems.map(i => [i.quantity, i.unitPrice, i.amount]), [[2,1800,3600]]);
});
test('unknown quantities stay null; incomplete invoices cannot proceed', () => {
  const n = normalizeTimefitAxExtraction({documentType:'invoice', merchantName:'상점',transactionDate:'2026-10-01',totalAmount:3600,lineItems:[{name:'감자',quantity:null,unitPrice:null,amount:3600}]});
  assert.equal(n.lineItems[0].quantity,null);
  assert.equal(receiptValidation(n).validForManagerReview,false);
  assert.equal(n.extractionProvider,'timefit_ax_unknown');
});
test('balance-only total is not selected as current expense', () => {
  assert.equal(parseReceiptText('거래명세서\n지프레시\n전미수금 7,401,385\n총합계 7,461,535').totalAmount,null);
});
test('discount arithmetic and mismatches are gated', () => {
  const base={merchantName:'상점',transactionDate:'2026-10-01',totalAmount:15000,lineItems:[{quantity:2,unitPrice:8000,discountAmount:1000,lineAmount:15000}]};
  assert.equal(receiptValidation(base).validForManagerReview,true);
  base.lineItems[0].discountAmount=0;
  assert.equal(receiptValidation(base).validForManagerReview,false);
});
for (const slope of [0,0.08,-0.08]) test('table coordinates preserve six rows at slope '+slope, () => {
  const entries=[['품명',150,100],['BOX',350,100],['총수량',500,100],['단가',650,100],['금액',800,100],['합계',150,450]];
  items.forEach(([name,q,p,a],i)=>entries.push([name,150,150+i*40],[String(q),500,150+i*40],[String(p),650,150+i*40],[String(a),800,150+i*40]));
  const words=entries.map(([s,x,y])=>({symbols:[...s].map(text=>({text})),boundingBox:{vertices:[[-20,-8],[20,-8],[20,8],[-20,8]].map(([dx,dy])=>({x:x+dx,y:y+dy+slope*(x+dx)}))}}));
  const result=parseVisionResponses([{fullTextAnnotation:{text,pages:[{blocks:[{paragraphs:[{words}]}]}]}}]);
  assert.deepEqual(result.lineItems.map(i=>[i.name,i.quantity,i.unitPrice,i.amount]),items);
});
