import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupGranterFinanceRows,
  normalizeGranterFinanceTicket,
  summarizeGranterFinanceRows,
  todayInSeoul,
} from '../server/api/granter-finance-analytics.js';
import { filterGranterRows, formatBusinessNumber, summarizeFilteredGranterRows } from '../src/features/finance/granterAnalyticsModel.js';

const assets = new Map([['21750', { id: 21750, assetType: 'BANK_ACCOUNT', name: '국민은행 3843' }]]);
const contacts = new Map([['11', { id: 11, companyName: '식자재상사', registrationNumber: '123-45-67890' }]]);

test('Granter finance tickets retain account, tag, asset, contact, and business identity', () => {
  const row = normalizeGranterFinanceTicket({
    id: 1,
    amount: 41600,
    transactionType: 'OUT',
    transactAt: '2026-10-31T18:17:17',
    content: '식자재 구매',
    assetId: 21750,
    contactId: 11,
    expenseCategory: { id: 374, name: '상품매출원가', subInfo: '매출원가' },
    ticketTags: [{ id: 9303, name: 'BOH' }],
    isIncluded: true,
  }, 'BANK_TRANSACTION_TICKET', assets, contacts);
  assert.equal(row.category, '상품매출원가');
  assert.equal(row.categorySeries, '매출원가');
  assert.equal(row.tags[0].name, 'BOH');
  assert.equal(row.asset, '국민은행 3843');
  assert.equal(row.contact, '식자재상사');
  assert.equal(row.businessNumber, '1234567890');
});

test('tax invoices preserve supplier and contractor registration numbers', () => {
  const row = normalizeGranterFinanceTicket({
    id: 2,
    amount: 110000,
    transactionType: 'OUT',
    transactAt: '2026-10-01T00:00:00',
    content: '식자재 세금계산서',
    taxInvoice: {
      supplier: { registrationNumber: '111-22-33333' },
      contractor: { registrationNumber: '810-86-03669' },
    },
  }, 'TAX_INVOICE_TICKET');
  assert.equal(row.supplierBusinessNumber, '1112233333');
  assert.equal(row.contractorBusinessNumber, '8108603669');
});

test('analytics groups included rows without losing excluded source counts', () => {
  const rows = [
    { id: '1', amount: 100, direction: 'out', isIncluded: true, isClassified: true, categoryId: 1, category: '소모품비', tags: [{ id: 9, name: 'BOH' }], referenceCount: 1, attachmentCount: 1 },
    { id: '2', amount: 40, direction: 'in', isIncluded: true, isClassified: false, category: '미분류', tags: [{ id: 9, name: 'BOH' }], referenceCount: 0, attachmentCount: 0 },
    { id: '3', amount: 20, direction: 'out', isIncluded: false, isClassified: false, category: '미분류', tags: [], referenceCount: 0, attachmentCount: 0 },
  ];
  const summary = summarizeGranterFinanceRows(rows);
  assert.deepEqual({ source: summary.sourceCount, included: summary.includedCount, excluded: summary.excludedCount }, { source: 3, included: 2, excluded: 1 });
  assert.equal(summary.netAmount, -60);
  const tags = groupGranterFinanceRows(rows, 'tag');
  assert.equal(tags[0].label, 'BOH');
  assert.equal(tags[0].count, 2);
});

test('client filters search business numbers and summarize the visible rows', () => {
  const rows = [
    { id: '1', content: '구매', businessNumber: '1234567890', category: '소모품비', tags: [], asset: '통장', contact: '식자재상사', ticketTypeLabel: '통장', isIncluded: true, direction: 'out', amount: 5000 },
    { id: '2', content: '매출', businessNumber: '9999999999', category: '상품매출', tags: [], asset: '통장', contact: '고객', ticketTypeLabel: '통장', isIncluded: true, direction: 'in', amount: 9000 },
  ];
  const filtered = filterGranterRows(rows, { query: '123-45'.replace(/\D/g, '') });
  assert.equal(filtered.length, 1);
  assert.equal(summarizeFilteredGranterRows(filtered).outAmount, 5000);
  assert.equal(formatBusinessNumber('8108603669'), '810-86-03669');
});

test('all-period analytics ends on the current Seoul business date', () => {
  assert.equal(todayInSeoul(new Date('2026-11-18T16:30:00.000Z')), '2026-11-19');
});
