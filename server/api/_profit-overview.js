import { financeRest } from './_finance-server.js';
import { buildDailyLaborMap } from './finance-report.js';
import { loadFinanceFacts, saveProfitSnapshot } from './_profit-store.js';

export const PROFIT_CALCULATION_VERSION = 'profit-v1';
const encode = value => encodeURIComponent(String(value));
const dateOnly = value => String(value || '').slice(0, 10);
const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
const datesInRange = (from, to) => Array.from({ length: daysBetween(from, to) }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10));
const monthsInRange = (from, to) => [...new Set(datesInRange(from, to).map(date => date.slice(0, 7)))];
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
const ratio = (value, base) => base ? Math.round((value / base) * 1000) / 10 : null;
const todayInSeoul = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);

export function profitSnapshotKey({ from, to, groupBy = 'day' }) {
  return `${PROFIT_CALCULATION_VERSION}:${groupBy}:${from}:${to}`;
}

export function buildProfitOverview({ from, to, facts = [], salesRows = [], payrollDrafts = [], payrollLines = [], attendanceRecords = [], latestRun = null, salesConnection = null, today = todayInSeoul() }) {
  const dailyLabor = buildDailyLaborMap({ payrollDrafts, payrollLines, attendanceRecords });
  const daily = new Map(datesInRange(from, to).map(date => [date, {
    date, sales: 0, purchaseCost: 0, laborCost: Number(dailyLabor.get(date) || 0), operatingExpenses: 0, unclassified: 0,
  }]));
  salesRows.forEach(row => {
    const target = daily.get(dateOnly(row.sales_date));
    if (target) target.sales += Number(row.completed_amount || 0);
  });
  const categories = new Map();
  facts.filter(fact => fact.include_in_profit && fact.direction === 'out').forEach(fact => {
    const target = daily.get(dateOnly(fact.occurred_on));
    if (!target) return;
    const amount = Number(fact.amount || 0);
    if (fact.profit_bucket === 'purchase_cost') target.purchaseCost += amount;
    else {
      target.operatingExpenses += amount;
      if (fact.profit_bucket === 'unclassified') target.unclassified += amount;
    }
    const category = fact.source_category_name || '미분류';
    categories.set(category, (categories.get(category) || 0) + amount);
  });
  const series = [...daily.values()].map(row => ({
    ...row,
    grossContribution: row.sales - row.purchaseCost,
    operatingProfit: row.sales - row.purchaseCost - row.laborCost - row.operatingExpenses,
  }));
  const totals = {
    netSales: sum(series, 'sales'),
    purchaseCost: sum(series, 'purchaseCost'),
    laborCost: sum(series, 'laborCost'),
    operatingExpenses: sum(series, 'operatingExpenses'),
    unclassifiedAmount: sum(series, 'unclassified'),
    grossContribution: sum(series, 'grossContribution'),
    operatingProfit: sum(series, 'operatingProfit'),
  };
  totals.purchaseCostRate = ratio(totals.purchaseCost, totals.netSales);
  totals.laborCostRate = ratio(totals.laborCost, totals.netSales);
  totals.operatingExpenseRate = ratio(totals.operatingExpenses, totals.netSales);
  totals.profitMargin = ratio(totals.operatingProfit, totals.netSales);

  const requiredMonths = monthsInRange(from, to);
  const expectedDataTo = to < today ? to : today;
  const expectedSalesDates = from <= expectedDataTo ? datesInRange(from, expectedDataTo) : [];
  const salesByDate = new Map(salesRows.map(row => [dateOnly(row.sales_date), row]));
  const draftMonths = new Set(payrollDrafts.map(draft => dateOnly(draft.settlement_month).slice(0, 7)));
  const missingPayrollMonths = requiredMonths.filter(month => !draftMonths.has(month));
  const granterReady = latestRun?.status === 'succeeded'
    && dateOnly(latestRun.range_from) <= from
    && dateOnly(latestRun.range_to) >= expectedDataTo;
  const granterPresent = Boolean(latestRun && facts.length >= 0);
  const salesReady = Boolean(salesConnection) && expectedSalesDates.every(date => {
    const row = salesByDate.get(date);
    return row && !['pending', 'incomplete'].includes(row.finalization_status);
  });
  const payrollReady = missingPayrollMonths.length === 0;
  const classificationReady = totals.unclassifiedAmount === 0;
  const periodClosed = to < today;
  const hardGates = [
    { id: 'sales', label: '매출 연결', passed: salesReady },
    { id: 'expenses', label: 'Granter 지출 동기화', passed: granterReady, detail: latestRun?.status || '동기화 이력 없음' },
    { id: 'payroll', label: '급여 초안', passed: payrollReady, detail: missingPayrollMonths.join(', ') || null },
    { id: 'classification', label: '지출 분류', passed: classificationReady, detail: classificationReady ? null : `${totals.unclassifiedAmount.toLocaleString('ko-KR')}원 미분류` },
    { id: 'period', label: '기간 종료', passed: periodClosed, detail: periodClosed ? null : '진행 중인 기간' },
  ];
  const missingCore = !salesReady || !granterPresent || !payrollReady;
  const status = missingCore ? 'incomplete' : hardGates.every(gate => gate.passed) ? 'actual' : 'provisional';
  const completeness = {
    status,
    score: Math.round(hardGates.filter(gate => gate.passed).length / hardGates.length * 100),
    hardGates,
    missingPayrollMonths,
    unclassifiedCount: facts.filter(fact => fact.profit_bucket === 'unclassified' && fact.include_in_profit).length,
    laborBasis: dailyLabor.basis,
  };
  return {
    from, to, groupBy: 'day', status, calculationVersion: PROFIT_CALCULATION_VERSION,
    totals,
    series,
    breakdown: { categories: [...categories.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount) },
    completeness,
    sourceVersions: {
      granter: latestRun ? { runId: latestRun.id, status: latestRun.status, finishedAt: latestRun.finished_at } : null,
      tossplace: salesConnection ? { lastSyncedAt: salesConnection.last_synced_at, status: salesConnection.connection_status } : null,
      payroll: { months: requiredMonths, draftCount: payrollDrafts.length },
    },
  };
}

async function loadProfitInputs({ organizationId, from, to }) {
  const monthFrom = `${from.slice(0, 7)}-01`;
  const monthTo = `${to.slice(0, 7)}-31`;
  const today = todayInSeoul();
  const expectedDataTo = to < today ? to : today;
  const [facts, salesRows, payrollDrafts, attendanceRecords, runRows, salesConnections] = await Promise.all([
    loadFinanceFacts({ organizationId, from, to }),
    financeRest(`timefit_user_tossplace_daily_sales?organization_id=eq.${encode(organizationId)}&sales_date=gte.${encode(from)}&sales_date=lte.${encode(to)}&select=sales_date,completed_amount,completed_order_count,finalization_status`),
    financeRest(`timefit_user_payroll_drafts?organization_id=eq.${encode(organizationId)}&settlement_month=gte.${encode(monthFrom)}&settlement_month=lte.${encode(monthTo)}&select=id,settlement_month,status`),
    financeRest(`timefit_user_attendance_records?organization_id=eq.${encode(organizationId)}&work_date=gte.${encode(monthFrom)}&work_date=lte.${encode(monthTo)}&checked_out_at=not.is.null&select=staff_id,work_date,checked_in_at,checked_out_at`),
    financeRest(`timefit_user_granter_sync_runs?organization_id=eq.${encode(organizationId)}&range_from=lte.${encode(from)}&range_to=gte.${encode(expectedDataTo)}&status=in.(succeeded,partial,running)&select=id,status,range_from,range_to,finished_at,updated_at&order=created_at.desc&limit=1`),
    financeRest(`timefit_user_tossplace_connections?organization_id=eq.${encode(organizationId)}&sync_enabled=eq.true&select=id,last_synced_at,connection_status&limit=1`),
  ]);
  const payrollLines = payrollDrafts.length ? await financeRest(`timefit_user_payroll_draft_lines?payroll_draft_id=in.(${payrollDrafts.map(item => encode(item.id)).join(',')})&select=payroll_draft_id,staff_id,pay_type,estimated_total`) : [];
  return { facts, salesRows, payrollDrafts, payrollLines, attendanceRecords, latestRun: runRows[0] || null, salesConnection: salesConnections[0] || null };
}

export async function rebuildProfitSnapshot({ organizationId, from, to }) {
  const overview = buildProfitOverview({ from, to, ...await loadProfitInputs({ organizationId, from, to }) });
  const generatedAt = new Date().toISOString();
  await saveProfitSnapshot({
    organization_id: organizationId,
    snapshot_key: profitSnapshotKey({ from, to }),
    period_start: from,
    period_end: to,
    group_by: 'day',
    status: overview.status,
    calculation_version: overview.calculationVersion,
    totals: overview.totals,
    series: overview.series,
    breakdown: overview.breakdown,
    completeness: overview.completeness,
    source_versions: overview.sourceVersions,
    generated_at: generatedAt,
  });
  return { ...overview, generatedAt };
}

export function snapshotRowToOverview(row) {
  return {
    from: row.period_start,
    to: row.period_end,
    groupBy: row.group_by,
    status: row.status,
    calculationVersion: row.calculation_version,
    totals: row.totals || {},
    series: row.series || [],
    breakdown: row.breakdown || {},
    completeness: row.completeness || {},
    sourceVersions: row.source_versions || {},
    generatedAt: row.generated_at,
  };
}
