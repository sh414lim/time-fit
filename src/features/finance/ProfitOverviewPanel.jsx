import React, { useEffect, useMemo, useState } from 'react';
import { loadProfitOverview } from '../../lib/supabase';

const won = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const shortWon = value => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 100000000) return `${(amount / 100000000).toFixed(1)}억`;
  if (Math.abs(amount) >= 10000) return `${Math.round(amount / 10000).toLocaleString('ko-KR')}만`;
  return amount.toLocaleString('ko-KR');
};
const statusLabel = { actual: '확정 가능', provisional: '검토 필요', incomplete: '데이터 부족' };

function ProfitChart({ rows = [] }) {
  const points = useMemo(() => {
    const width = 720; const height = 180; const left = 18; const right = 18; const top = 16; const bottom = 24;
    const values = rows.flatMap(row => [Number(row.sales || 0), Number(row.operatingProfit || 0)]);
    const max = Math.max(1, ...values); const min = Math.min(0, ...values); const span = Math.max(1, max - min);
    const point = (row, index, field) => `${left + (rows.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (rows.length - 1))},${top + (height - top - bottom) * (max - Number(row[field] || 0)) / span}`;
    return { width, height, bottom, sales: rows.map((row, index) => point(row, index, 'sales')).join(' '), profit: rows.map((row, index) => point(row, index, 'operatingProfit')).join(' ') };
  }, [rows]);
  if (!rows.length) return <div className="profit-overview-empty">표시할 손익 데이터가 없습니다.</div>;
  return <svg className="profit-overview-chart" viewBox={`0 0 ${points.width} ${points.height}`} role="img" aria-label="일별 매출과 영업이익 추이">
    {[0, 1, 2, 3].map(index => <line key={index} x1="18" x2={points.width - 18} y1={16 + index * 42} y2={16 + index * 42}/>) }
    <polyline className="sales" points={points.sales}/><polyline className="profit" points={points.profit}/>
    {rows.map((row, index) => index % Math.max(1, Math.ceil(rows.length / 6)) === 0 && <text key={row.date} x={18 + (rows.length <= 1 ? 342 : index * 684 / (rows.length - 1))} y={points.height - 4}>{row.date.slice(5).replace('-', '.')}</text>)}
  </svg>;
}

export default function ProfitOverviewPanel({ organizationId, from, to }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async (refresh = false) => {
    setLoading(true); setError('');
    try { setOverview(await loadProfitOverview({ organizationId, from, to, refresh })); }
    catch (nextError) { setError(nextError.message || '손익 현황을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (organizationId) load(false); }, [organizationId, from, to]);
  const totals = overview?.totals || {};
  const failedGates = overview?.completeness?.hardGates?.filter(gate => !gate.passed) || [];
  return <section className="profit-overview" aria-busy={loading}>
    <header><div><span>TIMEFIT PROFIT</span><h3>매장 손익 현황</h3><p>매출·구매비·인건비·운영비를 저장된 데이터로 계산합니다.</p></div><div className="profit-overview-state"><b className={overview?.status || 'incomplete'}>{statusLabel[overview?.status] || '계산 중'}</b><button type="button" className="outline" onClick={() => load(true)} disabled={loading}>↻ 저장 데이터 다시 계산</button></div></header>
    {error && <div className="finance-hub-warning" role="alert">{error}<button type="button" onClick={() => load(false)}>다시 시도</button></div>}
    {loading && !overview ? <div className="profit-overview-loading">저장된 손익 집계를 불러오는 중입니다.</div> : overview && <>
      <div className="profit-overview-kpis">
        <article><span>순매출</span><b>{won(totals.netSales)}</b><small>POS 매출 기준</small></article>
        <article><span>재료·상품 구매비</span><b>{won(totals.purchaseCost)}</b><small>매출 대비 {totals.purchaseCostRate ?? '-'}%</small></article>
        <article><span>인건비</span><b>{won(totals.laborCost)}</b><small>매출 대비 {totals.laborCostRate ?? '-'}%</small></article>
        <article><span>운영비</span><b>{won(totals.operatingExpenses)}</b><small>미분류 {won(totals.unclassifiedAmount)}</small></article>
        <article className={Number(totals.operatingProfit || 0) < 0 ? 'negative' : 'positive'}><span>영업이익</span><b>{won(totals.operatingProfit)}</b><small>이익률 {totals.profitMargin ?? '-'}%</small></article>
      </div>
      <div className="profit-overview-grid"><article className="profit-overview-box"><div className="profit-overview-box-head"><div><h4>일별 매출·영업이익</h4><p>페이지를 다시 열어도 DB 저장본을 즉시 표시합니다.</p></div><div><span className="sales">매출</span><span className="profit">영업이익</span></div></div><ProfitChart rows={overview.series}/></article>
      <article className="profit-overview-box"><div className="profit-overview-box-head"><div><h4>손익 구성</h4><p>순매출에서 실제 비용을 순서대로 차감합니다.</p></div></div><div className="profit-overview-bridge">{[['순매출', totals.netSales, 'sales'],['구매비', -totals.purchaseCost, 'cost'],['인건비', -totals.laborCost, 'cost'],['운영비', -totals.operatingExpenses, 'cost'],['영업이익', totals.operatingProfit, 'profit']].map(([label, amount, type]) => <div key={label} className={type}><span>{label}</span><b>{Number(amount) > 0 && type !== 'sales' ? '+' : ''}{shortWon(amount)}</b></div>)}</div></article></div>
      <footer><span>집계 저장 시각 {overview.generatedAt ? new Date(overview.generatedAt).toLocaleString('ko-KR') : '-'}</span><span>완성도 {overview.completeness?.score ?? 0}%</span>{failedGates.map(gate => <em key={gate.id}>{gate.label}: {gate.detail || '확인 필요'}</em>)}</footer>
    </>}
  </section>;
}
