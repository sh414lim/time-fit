import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { loadGranterFinanceAnalytics, loadGranterFinanceSyncRun, startGranterFinanceSync } from './granterAnalyticsClient';
import { filterGranterRows, formatBusinessNumber, granterMetric, summarizeFilteredGranterRows } from './granterAnalyticsModel';

const won = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const compactWon = value => {
  const amount = Number(value || 0);
  if (amount >= 100000000) return `${(amount / 100000000).toFixed(1)}억`;
  if (amount >= 10000) return `${Math.round(amount / 10000).toLocaleString('ko-KR')}만`;
  return amount.toLocaleString('ko-KR');
};
const SOURCE_COLORS = ['#3182f6', '#7a5af8', '#16a078', '#f59f3a', '#e85d75', '#3b82a0', '#a56b3f', '#64748b'];

function HorizontalChart({ title, description, groups = [], limit = 10, onSelect, empty = '집계할 데이터가 없습니다.' }) {
  const visible = groups.slice(0, limit);
  const max = Math.max(1, ...visible.map(granterMetric));
  return <article className="granter-chart-card">
    <header><div><h4>{title}</h4><p>{description}</p></div><span>{groups.length.toLocaleString('ko-KR')}개</span></header>
    {visible.length ? <div className="granter-horizontal-chart">{visible.map((group, index) => {
      const metric = granterMetric(group);
      return <button key={group.key} type="button" onClick={() => onSelect?.(group)}>
        <span title={group.label}>{group.label}</span>
        <i><em style={{ width: `${metric / max * 100}%`, background: SOURCE_COLORS[index % SOURCE_COLORS.length] }}/></i>
        <b>{compactWon(metric)}</b><small>{group.count.toLocaleString('ko-KR')}건</small>
      </button>;
    })}</div> : <div className="granter-chart-empty">{empty}</div>}
  </article>;
}

function MonthlyFlowChart({ groups = [] }) {
  const visible = groups.slice(-12);
  const max = Math.max(1, ...visible.flatMap(item => [item.inAmount, item.outAmount]));
  return <article className="granter-chart-card granter-monthly-card">
    <header><div><h4>월별 입금·출금 추이</h4><p>전체 기간에서 최근 12개월을 표시합니다</p></div><div className="granter-chart-legend"><span className="in">입금</span><span className="out">출금</span></div></header>
    {visible.length ? <div className="granter-monthly-chart" role="img" aria-label="월별 입금과 출금 막대그래프">{visible.map(item => <div key={item.key} title={`${item.key} · 입금 ${won(item.inAmount)} · 출금 ${won(item.outAmount)}`}>
      <i><em className="in" style={{ height: `${item.inAmount / max * 100}%` }}/><em className="out" style={{ height: `${item.outAmount / max * 100}%` }}/></i>
      <span>{item.key.slice(2).replace('-', '.')}</span>
    </div>)}</div> : <div className="granter-chart-empty">월별 거래가 없습니다.</div>}
  </article>;
}

function GranterTransactionTable({ rows }) {
  if (!rows.length) return <div className="granter-chart-empty table-empty">조건에 맞는 거래가 없습니다.</div>;
  return <div className="granter-table-wrap"><table className="granter-table"><thead><tr><th>거래일</th><th>원천</th><th>내용·거래처</th><th>사업자등록번호</th><th>계정과목</th><th>태그</th><th>자산</th><th>포함</th><th>금액</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
    <td>{row.date}</td><td><span className="granter-source-badge">{row.ticketTypeLabel}</span></td>
    <td><b>{row.content}</b><small>{row.contact}</small></td>
    <td className="business-number">{formatBusinessNumber(row.businessNumber)}</td>
    <td><span className={row.isClassified ? 'granter-category-badge' : 'granter-category-badge missing'}>{row.category}</span></td>
    <td><div className="granter-tags">{row.tags?.length ? row.tags.map(tag => <span key={`${row.id}:${tag.id || tag.name}`}>{tag.name}</span>) : <small>-</small>}</div></td>
    <td>{row.asset}</td><td>{row.isIncluded ? '포함' : '제외'}</td>
    <td className={row.direction}>{row.direction === 'in' ? '+' : '-'}{won(row.amount)}</td>
  </tr>)}</tbody></table></div>;
}

function TaxInvoiceTable({ rows }) {
  if (!rows.length) return <div className="granter-chart-empty table-empty">해당 기간의 세금계산서가 없습니다.</div>;
  return <div className="granter-table-wrap"><table className="granter-table tax-table"><thead><tr><th>작성일</th><th>내용·거래처</th><th>공급자 사업자번호</th><th>공급받는자 사업자번호</th><th>계정과목</th><th>구분</th><th>금액</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
    <td>{row.date}</td><td><b>{row.content}</b><small>{row.contact}</small></td>
    <td className="business-number">{formatBusinessNumber(row.supplierBusinessNumber || row.businessNumber)}</td>
    <td className="business-number">{formatBusinessNumber(row.contractorBusinessNumber)}</td>
    <td>{row.category}</td><td>{row.direction === 'in' ? '매출' : '매입'}</td>
    <td className={row.direction}>{row.direction === 'in' ? '+' : '-'}{won(row.amount)}</td>
  </tr>)}</tbody></table></div>;
}

function BusinessDirectory({ contacts = [], groups = [] }) {
  const totals = new Map(groups.map(group => [group.key, group]));
  if (!contacts.length) return <div className="granter-chart-empty table-empty">등록된 거래처가 없습니다.</div>;
  return <div className="granter-business-grid">{contacts.map(contact => {
    const group = totals.get(contact.registrationNumber) || null;
    return <article key={contact.id}><div><b>{contact.name}</b><span>{formatBusinessNumber(contact.registrationNumber)}</span></div><div><strong>{won(group?.outAmount || 0)}</strong><small>지출 · {group?.count || 0}건</small></div></article>;
  })}</div>;
}

export default function GranterAnalyticsPanel({ organizationId, from, to }) {
  const [scope, setScope] = useState('period');
  const [view, setView] = useState('analytics');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncRun, setSyncRun] = useState(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState({ category: '', tag: '', asset: '', contact: '', businessNumber: '', ticketType: '', direction: '', included: 'included' });
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const refresh = async (force = false) => {
    setLoading(true); setError('');
    try {
      const result = await loadGranterFinanceAnalytics({ organizationId, from, to, scope, refresh: force });
      if (!result.configured) throw new Error(result.error || 'Granter 연결 정보가 없습니다.');
      if (result.syncRequired) {
        const run = result.activeSyncRun || await startGranterFinanceSync({ organizationId, from, to, scope });
        setSyncRun(run);
        return;
      }
      setData(result);
    } catch (nextError) {
      setError(nextError.message || 'Granter 장부를 불러오지 못했습니다.');
    } finally { setLoading(false); }
  };
  useEffect(() => { setSyncRun(null); if (organizationId) refresh(false); }, [organizationId, from, to, scope]);
  useEffect(() => {
    if (!syncRun?.id || !['queued', 'running'].includes(syncRun.status)) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const run = await loadGranterFinanceSyncRun({ organizationId, runId: syncRun.id });
        if (cancelled) return;
        setSyncRun(run);
        if (['succeeded', 'partial'].includes(run.status)) await refresh(false);
        else if (run.status === 'failed') setError(run.error_message || '전체 기간 동기화를 완료하지 못했습니다.');
      } catch (nextError) {
        if (!cancelled) setError(nextError.message || '동기화 상태를 확인하지 못했습니다.');
      }
    }, 2000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [organizationId, syncRun?.id, syncRun?.status, syncRun?.completed_sources, syncRun?.failed_sources]);

  const rows = data?.transactions || [];
  const filteredRows = useMemo(() => filterGranterRows(rows, { ...filters, query: deferredQuery }), [rows, filters, deferredQuery]);
  const filteredSummary = useMemo(() => summarizeFilteredGranterRows(filteredRows), [filteredRows]);
  const invoiceRows = useMemo(() => filterGranterRows(data?.taxInvoices || [], { query: deferredQuery }), [data?.taxInvoices, deferredQuery]);
  const invoicePages = Math.max(1, Math.ceil(invoiceRows.length / pageSize));
  const pagedInvoices = invoiceRows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [data, deferredQuery]);
  const groups = data?.groups || {};
  const selectFilter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setView('transactions'); };
  const resetFilters = () => { setFilters({ category: '', tag: '', asset: '', contact: '', businessNumber: '', ticketType: '', direction: '', included: 'included' }); setQuery(''); };

  return <section className="granter-analytics" aria-busy={loading}>
    <header className="granter-analytics-header"><div><span>GRANTER LIVE BOOK</span><h3>그랜터 전체 장부 분석</h3><p>계정과목·태그·자산·거래처·세금계산서·사업자번호를 한 번에 조회합니다.</p></div><div className="granter-analytics-actions"><div className="granter-scope-switch" role="group" aria-label="Granter 조회 범위"><button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>전체 기간</button><button type="button" className={scope === 'period' ? 'active' : ''} onClick={() => setScope('period')}>선택 월</button></div><button className="outline" type="button" onClick={() => refresh(true)} disabled={loading || ['queued', 'running'].includes(syncRun?.status)}>↻ 다시 불러오기</button></div></header>
    {loading && <div className="granter-loading"><i/><div><b>{scope === 'all' ? '전체 장부를 안전하게 나눠 불러오는 중입니다' : '선택 월 장부를 불러오는 중입니다'}</b><span>거래 유형별로 수집하고 그래프를 계산하고 있어요.</span></div></div>}
    {syncRun && ['queued', 'running'].includes(syncRun.status) && <div className="granter-sync-progress" role="status"><div><span>전체 기간 동기화</span><b>{Number(syncRun.completed_sources || 0) + Number(syncRun.failed_sources || 0)}/{syncRun.total_sources || 12}개 원천 처리</b></div><i><em style={{ width: `${Math.min(100, (Number(syncRun.completed_sources || 0) + Number(syncRun.failed_sources || 0)) / Math.max(1, Number(syncRun.total_sources || 12)) * 100)}%` }}/></i><p>화면을 이동해도 서버에서 계속 수집하며, 다시 돌아오면 진행 상태를 복원합니다.</p></div>}
    {error && <div className="finance-hub-warning" role="alert">{error}<button type="button" onClick={() => refresh(true)}>다시 시도</button></div>}
    {!loading && data && <>
      <div className="granter-connection-line"><span className="connected">● 연결됨</span><b>{data.workspace?.name}</b><span>{data.range?.from} ~ {data.range?.to}</span><span>API {data.apiRevision || '리비전 미확인'}</span>{data.persisted ? <span>저장본 · {data.syncRun?.finishedAt ? new Date(data.syncRun.finishedAt).toLocaleString('ko-KR') : '완료'}</span> : null}<span>계정과목 {data.references?.accountingCategoryCount || 0}개</span><span>태그 {data.references?.tags?.length || 0}개</span><span>자산 {data.references?.assets?.length || 0}개</span><span>거래처 {data.references?.contactCount || 0}개</span></div>
      {data.warnings?.length ? <div className="granter-partial-warning">{data.partial ? `${data.sourceStatus?.filter(item => item.status === 'loaded').length || 0}/${data.sourceStatus?.length || 0}개 원천을 먼저 표시합니다. 일시 제한 원천은 다시 불러오기로 재시도할 수 있습니다.` : `일부 미연동·권한 제한 원천 ${data.warnings.length}개는 제외했습니다. 연결된 원천 데이터는 모두 표시합니다.`}</div> : null}
      <nav className="granter-subtabs" aria-label="Granter 장부 보기">{[['analytics','분류·그래프'],['transactions','전체 거래'],['tax','세금계산서'],['business','사업자번호']].map(([id, label]) => <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}{id === 'tax' ? <em>{data.taxInvoices?.length || 0}</em> : null}</button>)}</nav>

      {view === 'analytics' && <>
        <div className="granter-kpis"><article><span>장부 포함 입금</span><b>{won(data.summary?.inAmount)}</b><small>{data.summary?.includedCount || 0}건 포함</small></article><article><span>장부 포함 출금</span><b>{won(data.summary?.outAmount)}</b><small>순액 {won(data.summary?.netAmount)}</small></article><article><span>계정과목 분류</span><b>{data.summary?.classifiedCount || 0}건</b><small>미분류 {data.summary?.unclassifiedCount || 0}건</small></article><article><span>집계 제외</span><b>{data.summary?.excludedCount || 0}건</b><small>원천 전체 {data.summary?.sourceCount || 0}건</small></article></div>
        <div className="granter-chart-grid wide"><MonthlyFlowChart groups={groups.months}/><HorizontalChart title="계정과목 계열" description="매출·원가·판관비·자산·부채 계열" groups={groups.categorySeries}/></div>
        <div className="granter-chart-grid"><HorizontalChart title="계정과목별" description="그랜터에 지정된 계정과목" groups={groups.categories} limit={12} onSelect={group => selectFilter('category', group.label)}/><HorizontalChart title="태그별" description="BOH·FOH 등 다중 운영 태그" groups={groups.tags} onSelect={group => selectFilter('tag', group.label)}/><HorizontalChart title="자산별" description="카드·통장·홈택스·정산 자산" groups={groups.assets} onSelect={group => selectFilter('asset', group.label)}/><HorizontalChart title="거래처별" description="사업자와 사용처 기준 상위 거래" groups={groups.contacts} onSelect={group => selectFilter('contact', group.label)}/><HorizontalChart title="사업자번호별" description="사업자등록번호 기준 거래 집계" groups={groups.businessNumbers} onSelect={group => selectFilter('businessNumber', group.key)}/><HorizontalChart title="원천별" description="카드·통장·세금계산서·현금영수증·정산" groups={groups.ticketTypes} limit={12} onSelect={group => selectFilter('ticketType', group.key)}/></div>
        <div className="granter-source-status"><header><h4>연동 원천 상태</h4><span>{data.sourceStatus?.filter(item => item.status === 'loaded').length || 0}/{data.sourceStatus?.length || 0}개 연결</span></header><div>{data.sourceStatus?.map(item => <article key={item.ticketType} className={item.status}><span>{item.label}</span><b>{item.count.toLocaleString('ko-KR')}건</b><small>{item.status === 'loaded' ? '불러옴' : item.reason || '미연동'}</small></article>)}</div></div>
      </>}

      {view === 'transactions' && <><div className="granter-filter-panel"><label><span>통합 검색</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="거래처, 적요, 사업자번호, 계정과목 검색"/></label><select value={filters.ticketType} onChange={event => setFilters(current => ({ ...current, ticketType: event.target.value }))}><option value="">전체 원천</option>{groups.ticketTypes?.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select><select value={filters.direction} onChange={event => setFilters(current => ({ ...current, direction: event.target.value }))}><option value="">입출금 전체</option><option value="in">입금·수입</option><option value="out">출금·지출</option></select><select value={filters.included} onChange={event => setFilters(current => ({ ...current, included: event.target.value }))}><option value="included">장부 포함</option><option value="excluded">집계 제외</option><option value="">전체</option></select><button className="outline" type="button" onClick={resetFilters}>초기화</button></div><div className="granter-filter-summary"><span>{filteredSummary.count.toLocaleString('ko-KR')}건</span><b>입금 {won(filteredSummary.inAmount)}</b><b>출금 {won(filteredSummary.outAmount)}</b>{data.transactionsTruncated ? <em>화면 성능을 위해 최신 4,000건을 표시합니다.</em> : null}</div><GranterTransactionTable rows={filteredRows}/></>}

      {view === 'tax' && <><div className="granter-list-head"><div><h4>세금계산서 전체</h4><p>공급자·공급받는자 사업자등록번호를 함께 표시합니다.</p></div><label><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="상호·사업자번호 검색"/></label></div><TaxInvoiceTable rows={pagedInvoices}/>{invoicePages > 1 && <div className="granter-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>이전</button><span>{page} / {invoicePages}</span><button type="button" disabled={page >= invoicePages} onClick={() => setPage(value => value + 1)}>다음</button></div>}</>}

      {view === 'business' && <><div className="granter-list-head"><div><h4>거래처 사업자번호</h4><p>그랜터 거래처 기준정보와 장부 지출을 대조합니다.</p></div><label><input value={query} onChange={event => setQuery(event.target.value)} placeholder="상호·사업자번호 검색"/></label></div><BusinessDirectory contacts={(data.references?.contacts || []).filter(contact => !deferredQuery || `${contact.name} ${contact.registrationNumber}`.toLowerCase().includes(deferredQuery.toLowerCase()))} groups={groups.businessNumbers}/></>}
      <p className="granter-accounting-note">한 거래가 여러 태그를 가지면 태그별 합계는 중복될 수 있습니다. 정산과 연결된 계좌 입금은 그랜터의 장부 포함·제외 상태를 그대로 따릅니다.</p>
    </>}
  </section>;
}
