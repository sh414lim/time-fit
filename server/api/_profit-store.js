import { createHash } from 'node:crypto';
import { financeRest } from './_finance-server.js';

const encode = value => encodeURIComponent(String(value));
const UPSERT_BATCH_SIZE = 250;
const READ_PAGE_SIZE = 1000;

const categoryText = row => `${row?.categorySeries || ''} ${row?.category || ''} ${row?.content || ''}`.trim();

export function classifyGranterProfitFact(row = {}) {
  if (row.isIncluded === false) return { profitBucket: 'excluded', includeInProfit: false, provisional: false };
  if (row.direction === 'in') return { profitBucket: 'excluded', includeInProfit: false, provisional: false };

  const value = categoryText(row);
  if (!row.isClassified || !row.categoryId) return { profitBucket: 'unclassified', includeInProfit: true, provisional: true };
  if (/급여|임금|상여|잡급|일용직|퇴직급여|복리후생|사회보험|사대보험|4대보험/.test(value)) return { profitBucket: 'labor', includeInProfit: false, provisional: false };
  if (/계좌이체|내부이체|자금이체|현금이동|대체거래/.test(value)) return { profitBucket: 'transfer', includeInProfit: false, provisional: false };
  if (/대출|차입금|상환원금|자본금|투자금|가지급금|가수금/.test(value)) return { profitBucket: 'finance', includeInProfit: false, provisional: false };
  if (/법인세|부가세|소득세|세금과공과.*부가|예수금|대급금/.test(value)) return { profitBucket: 'tax', includeInProfit: false, provisional: false };
  if (/자산|보증금|시설장치|기계장치|차량운반|토지|건물|집기비품/.test(value)) return { profitBucket: 'asset', includeInProfit: false, provisional: false };
  if (/매출원가|상품매입|원재료|식자재|재료비|주류매입|포장재|소모성재료/.test(value)) return { profitBucket: 'purchase_cost', includeInProfit: true, provisional: false };
  return { profitBucket: 'opex', includeInProfit: true, provisional: false };
}

function sourceHash(row) {
  return createHash('sha256').update(JSON.stringify([
    row.id, row.date, row.direction, row.amount, row.categoryId, row.category,
    row.contactId, row.businessNumber, row.isIncluded,
  ])).digest('hex');
}

export function granterRowToFinanceFact({ organizationId, runId, revision, row, mapping = null }) {
  const classification = mapping ? {
    profitBucket: mapping.profit_bucket,
    includeInProfit: mapping.include_in_profit,
    provisional: mapping.profit_bucket === 'unclassified',
  } : classifyGranterProfitFact(row);
  return {
    organization_id: organizationId,
    source_system: 'granter',
    source_type: row.ticketType,
    source_id: String(row.id),
    sync_run_id: runId,
    occurred_on: row.date,
    direction: row.direction,
    amount: Math.max(0, Math.round(Number(row.amount || 0))),
    currency: 'KRW',
    content: row.content || null,
    contact_name: row.contact || null,
    business_number: row.businessNumber || null,
    asset_id: row.assetId ? String(row.assetId) : null,
    asset_name: row.asset || null,
    source_category_id: row.categoryId ? String(row.categoryId) : null,
    source_category_name: row.category || null,
    source_category_series: row.categorySeries || null,
    profit_bucket: classification.profitBucket,
    include_in_profit: classification.includeInProfit,
    is_provisional: classification.provisional,
    is_source_included: row.isIncluded !== false,
    source_revision: revision || null,
    tags: row.tags || [],
    raw_summary: {
      ticketId: row.ticketId,
      ticketTypeLabel: row.ticketTypeLabel,
      contactId: row.contactId,
      referenceCount: row.referenceCount || 0,
      attachmentCount: row.attachmentCount || 0,
    },
    source_hash: sourceHash(row),
    source_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export async function persistGranterFinanceFacts({ organizationId, runId, revision, sourceType, rows = [], rangeFrom, rangeTo }) {
  const mappings = await financeRest(
    `timefit_user_finance_category_mappings?organization_id=eq.${encode(organizationId)}&source_system=eq.granter&effective_from=lte.${encode(rangeTo)}&or=(effective_to.is.null,effective_to.gte.${encode(rangeFrom)})&select=source_category_id,profit_bucket,include_in_profit,effective_from,effective_to&order=effective_from.desc`,
  );
  const mappingFor = row => mappings.find(mapping => String(mapping.source_category_id) === String(row.categoryId)
    && mapping.effective_from <= row.date && (!mapping.effective_to || mapping.effective_to >= row.date));
  const facts = rows
    .filter(row => row.date >= rangeFrom && row.date <= rangeTo)
    .map(row => granterRowToFinanceFact({ organizationId, runId, revision, row, mapping: mappingFor(row) }));
  for (let index = 0; index < facts.length; index += UPSERT_BATCH_SIZE) {
    await financeRest('timefit_user_finance_facts?on_conflict=organization_id,source_system,source_type,source_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(facts.slice(index, index + UPSERT_BATCH_SIZE)),
    });
  }

  const staleFilters = [
    `organization_id=eq.${encode(organizationId)}`,
    'source_system=eq.granter',
    `source_type=eq.${encode(sourceType)}`,
    `occurred_on=gte.${encode(rangeFrom)}`,
    `occurred_on=lte.${encode(rangeTo)}`,
    `sync_run_id=neq.${encode(runId)}`,
  ];
  await financeRest(`timefit_user_finance_facts?${staleFilters.join('&')}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return { stored: facts.length };
}

export async function loadFinanceFacts({ organizationId, from, to }) {
  const rows = [];
  for (let offset = 0; ; offset += READ_PAGE_SIZE) {
    const page = await financeRest(
      `timefit_user_finance_facts?organization_id=eq.${encode(organizationId)}&occurred_on=gte.${encode(from)}&occurred_on=lte.${encode(to)}&is_source_included=eq.true&select=*&order=occurred_on.asc,id.asc&limit=${READ_PAGE_SIZE}&offset=${offset}`,
    );
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
  }
  return rows;
}

export async function loadLatestProfitSnapshot({ organizationId, snapshotKey }) {
  const rows = await financeRest(
    `timefit_user_profit_snapshots?organization_id=eq.${encode(organizationId)}&snapshot_key=eq.${encode(snapshotKey)}&select=*&limit=1`,
  );
  return rows[0] || null;
}

export async function saveProfitSnapshot(snapshot) {
  const rows = await financeRest('timefit_user_profit_snapshots?on_conflict=organization_id,snapshot_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ ...snapshot, updated_at: new Date().toISOString() }]),
  });
  return rows[0];
}
