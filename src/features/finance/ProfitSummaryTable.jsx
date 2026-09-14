import React, { useState } from 'react';

const won = value => `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;

export default function ProfitSummaryTable({ report, onOpenLedger }) {
  const [showAll, setShowAll] = useState(false);
  const rows = report?.displaySeries || report?.series || [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const completedRows = rows.filter(row => String(row.date).length === 7 || row.date <= today);
  const visibleRows = showAll ? rows : (completedRows.length ? completedRows : rows).slice(-10);
  const max = Math.max(1, ...visibleRows.map(row => Math.abs(Number(row.operatingProfit || 0))));
  const status = report?.audit?.status === 'closed' ? ['closed', '마감'] : report?.completeness?.cardSyncHealthy === false ? ['incomplete', '불완전'] : report?.completeness?.payrollComplete === false || report?.completeness?.reviewComplete === false || report?.completeness?.cardReconciliationComplete === false || Number(report?.totals?.provisionalCardExpenses || 0) > 0 ? ['provisional', '잠정 포함'] : ['confirmed', '확정 기준'];
  return <section className="finance-detail-table">
    <div className="finance-detail-title"><div><h3>기간별 손익표</h3><p>그래프의 숫자와 운영순익 산식을 한눈에 비교합니다.</p></div><span className={`finance-data-status ${status[0]}`}>{status[1]}</span></div>
    <div className="finance-detail-scroll"><div className="finance-detail-head"><span>기간</span><span>순매출</span><span>운영지출</span><span>확정 지출</span><span>잠정 카드</span><span>자동 계산</span><span>인건비</span><span>운영순익</span><span>순익률</span></div>{visibleRows.map(row => { const margin = row.sales ? Math.round(row.operatingProfit / row.sales * 1000) / 10 : null; const open = () => onOpenLedger?.(String(row.date).length === 7 ? `${row.date}-01` : row.date); return <article className={`${row.operatingProfit < 0 ? 'negative ' : ''}${onOpenLedger ? 'clickable' : ''}`} key={row.date} role={onOpenLedger ? 'button' : undefined} tabIndex={onOpenLedger ? 0 : undefined} onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') open(); }}><span><b>{row.date}</b><small>주문 {row.orderCount ?? 0}건</small></span><span>{won(row.sales)}</span><span>{won(row.operatingExpenses)}</span><span>{won(row.confirmedExpenses)}</span><span>{won(row.provisionalCardExpenses)}</span><span>{won(row.calculatedExpenses)}</span><span>{won(row.laborCost)}</span><strong><i style={{ width: `${Math.abs(Number(row.operatingProfit || 0)) / max * 100}%` }}/>{won(row.operatingProfit)}</strong><em>{margin === null ? '-' : `${margin}%`}</em></article>; })}</div>
    {rows.length > 10 && <button className="finance-table-more" type="button" onClick={() => setShowAll(value => !value)}>{showAll ? '최근 10개만 보기' : `전체 ${rows.length}개 기간 보기`}</button>}
  </section>;
}
