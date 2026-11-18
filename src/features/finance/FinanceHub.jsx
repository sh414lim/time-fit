import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { loadFinanceHub } from '../../lib/supabase';
import { buildFinanceSeries, monthRange, normalizeFinanceHubData, summarizeFinanceRows } from './financeHubModel';

const TABS = [['overview', '통합 현황'], ['transactions', '전체 거래'], ['cards', '법인카드'], ['banks', '통장'], ['evidence', '증빙 매칭']];
const CATEGORY_COLORS = ['#3182f6', '#7a5af8', '#16a078', '#f59f3a', '#e85d75', '#64748b', '#3b82a0', '#a56b3f'];
const won = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const shortWon = value => Number(value || 0) >= 100000000 ? `${(Number(value) / 100000000).toFixed(1)}억` : Number(value || 0) >= 10000 ? `${(Number(value) / 10000).toFixed(0)}만` : Number(value || 0).toLocaleString('ko-KR');
const evidenceLabel = { complete: '증빙 완료', review: '검토 대기', missing: '미증빙', not_required: '증빙 불필요' };

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function downloadRows(rows, month) {
  const header = ['거래일', '유형', '거래처·적요', '자산', '입출금', '카테고리', '증빙', '금액'];
  const body = rows.map(row => [row.date, row.sourceLabel, row.merchant, row.asset, row.direction === 'deposit' ? '입금' : '출금', row.category, evidenceLabel[row.evidence] || row.evidence, row.amount]);
  const blob = new Blob([`\uFEFF${[header, ...body].map(line => line.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `timefit-finance-${month}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function FlowChart({ daily }) {
  if (!daily.length) return <div className="finance-hub-empty chart-empty">선택한 기간의 거래가 없습니다.</div>;
  const width = 700; const height = 210; const left = 42; const right = 16; const top = 18; const bottom = 28;
  const max = Math.max(1, ...daily.flatMap(item => [item.expense, item.deposit]));
  const point = (item, index, key) => `${left + (daily.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (daily.length - 1))},${top + (height - top - bottom) * (1 - item[key] / max)}`;
  const expense = daily.map((item, index) => point(item, index, 'expense')).join(' ');
  const deposit = daily.map((item, index) => point(item, index, 'deposit')).join(' ');
  const area = `${left},${height - bottom} ${expense} ${width - right},${height - bottom}`;
  return <svg className="finance-hub-flow" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="일별 지출과 입금 흐름">
    {[0, 1, 2, 3].map(index => <line key={index} x1={left} x2={width - right} y1={top + index * (height - top - bottom) / 3} y2={top + index * (height - top - bottom) / 3}/>) }
    <polygon className="expense-area" points={area}/><polyline className="expense-line" points={expense}/><polyline className="deposit-line" points={deposit}/>
    {daily.map((item, index) => index % Math.max(1, Math.ceil(daily.length / 5)) === 0 && <text key={item.date} x={left + (daily.length === 1 ? (width - left - right) / 2 : index * (width - left - right) / (daily.length - 1))} y={height - 5}>{item.date.slice(5).replace('-', '/')}</text>)}
  </svg>;
}

function Empty({ children }) { return <div className="finance-hub-empty">{children}</div>; }

export default function FinanceHub({ organizationId, onOpenLedger, onOpenEvidence, onOpenCards }) {
  const storageKey = `timefit:finance-hub:${organizationId}`;
  const saved = useMemo(() => { if (typeof window === 'undefined') return {}; try { return JSON.parse(window.sessionStorage.getItem(storageKey) || '{}'); } catch { return {}; } }, [storageKey]);
  const [tab, setTab] = useState(saved.tab || 'overview');
  const [month, setMonth] = useState(saved.month || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).slice(0, 7));
  const [query, setQuery] = useState(saved.query || '');
  const [type, setType] = useState(saved.type || '');
  const [category, setCategory] = useState(saved.category || '');
  const [evidence, setEvidence] = useState(saved.evidence || '');
  const [data, setData] = useState({ expenses: [], cards: [], cardTransactions: [], bankAccounts: [], bankTransactions: [], documents: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [refreshedAt, setRefreshedAt] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  useEffect(() => { window.sessionStorage.setItem(storageKey, JSON.stringify({ tab, month, query, type, category, evidence })); }, [storageKey, tab, month, query, type, category, evidence]);
  const range = useMemo(() => monthRange(month), [month]);
  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const result = await loadFinanceHub({ organizationId, from: range.from, to: range.to });
      setData({ expenses: result.expenses || [], cards: result.cards || [], cardTransactions: result.cardTransactions || [], bankAccounts: result.bankAccounts || [], bankTransactions: result.bankTransactions || [], documents: result.documents || [] });
      if (result.warnings?.length) setError(`${result.warnings.length}개 원천을 불러오지 못했습니다. 표시된 데이터만 먼저 확인할 수 있습니다.`);
      setRefreshedAt(new Date(result.generatedAt || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch (nextError) {
      setError(nextError.message || '재무 통합 데이터를 불러오지 못했습니다.');
    } finally { setLoading(false); }
  };
  useEffect(() => { if (organizationId) refresh(); }, [organizationId, range.from, range.to]);
  const model = useMemo(() => normalizeFinanceHubData(data), [data]);
  const summary = useMemo(() => summarizeFinanceRows(model.rows), [model.rows]);
  const series = useMemo(() => buildFinanceSeries(model.rows), [model.rows]);
  const categories = series.categories;
  const filteredRows = useMemo(() => model.rows.filter(row => {
    const haystack = `${row.merchant} ${row.description} ${row.asset} ${row.category} ${row.amount}`.toLowerCase();
    return (!deferredQuery || haystack.includes(deferredQuery)) && (!type || row.type === type) && (!category || row.category === category) && (!evidence || row.evidence === evidence);
  }), [model.rows, deferredQuery, type, category, evidence]);
  const openTransactions = nextCategory => { if (nextCategory !== undefined) setCategory(nextCategory); setTab('transactions'); };
  const evidenceCounts = useMemo(() => model.rows.reduce((result, row) => ({ ...result, [row.evidence]: (result[row.evidence] || 0) + 1 }), {}), [model.rows]);
  const maxCategory = categories[0]?.amount || 1;
  const cardTotals = useMemo(() => model.rows.filter(row => row.type === 'card' && row.direction === 'withdrawal').reduce((map, row) => map.set(row.cardId, (map.get(row.cardId) || 0) + row.amount), new Map()), [model.rows]);
  const bankTotals = useMemo(() => model.rows.filter(row => row.type === 'bank').reduce((map, row) => { const current = map.get(row.bankAccountId) || { withdrawal: 0, deposit: 0 }; current[row.direction] += row.amount; map.set(row.bankAccountId, current); return map; }, new Map()), [model.rows]);
  return <section className="finance-hub" aria-busy={loading}>
    <header className="finance-hub-header">
      <div><p>카드·통장·증빙을 한곳에서</p><h2>재무 통합</h2><span className="finance-hub-sync">● {loading ? '최신 데이터를 불러오는 중' : `${refreshedAt || '-'} 동기화 · 카드 ${model.cards.length}개 · 통장 ${model.bankAccounts.length}개`}</span></div>
      <div className="finance-hub-actions"><label><span className="sr-only">조회 월</span><input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label><button className="outline" type="button" onClick={() => downloadRows(filteredRows, month)} disabled={!filteredRows.length}>↓ 내보내기</button><button className="submit" type="button" onClick={refresh} disabled={loading}>↻ 최신 내역</button></div>
    </header>
    {error && <div className="finance-hub-warning" role="status">{error}<button onClick={refresh}>다시 시도</button></div>}
    <div className="finance-hub-tabs" role="tablist" aria-label="재무 통합 화면">{TABS.map(([id, label]) => <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === 'evidence' && summary.missingEvidenceCount > 0 ? <em>{summary.missingEvidenceCount}</em> : null}</button>)}</div>
    {tab === 'overview' && <div className="finance-hub-panel">
      <div className="finance-hub-kpis">
        <button onClick={() => openTransactions('')}><span>총 지출</span><b>{won(summary.totalExpense)}</b><small>{model.rows.filter(row => row.direction === 'withdrawal').length.toLocaleString('ko-KR')}건</small></button>
        <button onClick={() => { setType('card'); openTransactions(''); }}><span>법인카드</span><b>{won(summary.cardExpense)}</b><small>{model.rows.filter(row => row.type === 'card').length.toLocaleString('ko-KR')}건</small></button>
        <button onClick={() => { setType('bank'); openTransactions(''); }}><span>통장 출금</span><b>{won(summary.bankWithdrawal)}</b><small>입금 {won(summary.deposits)}</small></button>
        <button className="attention" onClick={() => { setEvidence('missing'); setTab('evidence'); }}><span>미증빙 금액</span><b>{won(summary.missingEvidenceAmount)}</b><small>{summary.missingEvidenceCount}건 확인 필요</small></button>
      </div>
      <div className="finance-hub-grid main-chart"><article className="finance-hub-box"><div className="finance-hub-box-head"><div><h3>일별 자금 흐름</h3><p>카드·통장·원장 발생 기준</p></div><div className="finance-hub-legend"><span className="expense">지출</span><span className="deposit">입금</span></div></div><FlowChart daily={series.daily}/></article>
      <article className="finance-hub-box"><div className="finance-hub-box-head"><div><h3>카테고리별 지출</h3><p>막대를 누르면 거래가 필터링됩니다</p></div><button onClick={() => openTransactions('')}>전체 보기</button></div>{categories.length ? <div className="finance-hub-bars">{categories.slice(0, 8).map((item, index) => <button key={item.name} onClick={() => openTransactions(item.name)}><span>{item.name}</span><i><em style={{ width: `${item.amount / maxCategory * 100}%`, background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}/></i><b>{shortWon(item.amount)}</b></button>)}</div> : <Empty>분류할 지출이 없습니다.</Empty>}</article></div>
      <div className="finance-hub-grid"><article className="finance-hub-box"><div className="finance-hub-box-head"><div><h3>증빙 처리 현황</h3><p>거래별 영수증 연결 상태</p></div><button onClick={() => setTab('evidence')}>미처리 보기</button></div><div className="finance-hub-evidence"><div className="finance-hub-donut" style={{ '--complete': `${model.rows.length ? (evidenceCounts.complete || 0) / model.rows.length * 100 : 0}%` }}><div><b>{summary.missingEvidenceCount}</b><span>미처리</span></div></div><div>{[['complete','증빙 완료'],['review','검토 대기'],['missing','미증빙'],['not_required','증빙 불필요']].map(([id, label]) => <button key={id} onClick={() => { setEvidence(id); setTab('evidence'); }}><span>{label}</span><b>{evidenceCounts[id] || 0}건</b></button>)}</div></div></article>
      <article className="finance-hub-box"><div className="finance-hub-box-head"><div><h3>확인할 인사이트</h3><p>우선 처리할 재무 업무</p></div></div><div className="finance-hub-insights"><button onClick={() => setTab('evidence')}><i>!</i><span><b>미증빙 거래 {summary.missingEvidenceCount}건</b><small>영수증을 연결하거나 검토 상태를 확인하세요.</small></span><em>보기</em></button><button onClick={() => openTransactions('미분류')}><i>?</i><span><b>미분류 지출 {categories.find(item => item.name === '미분류') ? won(categories.find(item => item.name === '미분류').amount) : '0원'}</b><small>계정과목이 없는 거래를 분류하세요.</small></span><em>보기</em></button><button onClick={() => setTab(model.bankAccounts.length ? 'banks' : 'cards')}><i>↻</i><span><b>연결 자산 {model.cards.length + model.bankAccounts.length}개</b><small>마지막 수집 상태와 거래 누락을 확인하세요.</small></span><em>보기</em></button></div></article></div>
    </div>}
    {tab === 'transactions' && <div className="finance-hub-panel"><div className="finance-hub-search"><label><span className="sr-only">통합 거래 검색</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="거래처, 적요, 카드 끝자리, 금액 검색"/></label><select value={type} onChange={event => setType(event.target.value)} aria-label="거래 유형"><option value="">전체 유형</option><option value="card">법인카드</option><option value="bank">통장</option><option value="expense">직접 지출</option></select><select value={category} onChange={event => setCategory(event.target.value)} aria-label="카테고리"><option value="">전체 카테고리</option>{categories.map(item => <option key={item.name}>{item.name}</option>)}</select><select value={evidence} onChange={event => setEvidence(event.target.value)} aria-label="증빙 상태"><option value="">전체 증빙</option><option value="complete">증빙 완료</option><option value="review">검토 대기</option><option value="missing">미증빙</option><option value="not_required">증빙 불필요</option></select><button className="outline" onClick={() => { setQuery(''); setType(''); setCategory(''); setEvidence(''); }}>초기화</button></div><TransactionTable rows={filteredRows}/></div>}
    {tab === 'cards' && <div className="finance-hub-panel"><div className="finance-hub-section-head"><div><h3>법인카드</h3><p>카드별 이번 달 사용액과 수집 상태입니다.</p></div><button className="outline" onClick={onOpenCards}>카드 관리 열기</button></div>{model.cards.length ? <div className="finance-hub-assets">{model.cards.map(card => <article key={card.id}><span className="asset-icon card">▰</span><div><b>{card.nickname || card.issuer}</b><span>{card.issuer} •••• {card.last4} · {card.holder?.display_name || '공용'}</span><small>{card.last_synced_at ? `${new Date(card.last_synced_at).toLocaleString('ko-KR')} 수집` : '수집 이력 없음'}</small></div><strong>{won(cardTotals.get(card.id) || 0)}</strong></article>)}</div> : <Empty>연결된 법인카드가 없습니다. 카드 관리에서 Granter 법인카드를 연결해 주세요.</Empty>}<TransactionTable rows={filteredRows.filter(row => row.type === 'card')}/></div>}
    {tab === 'banks' && <div className="finance-hub-panel"><div className="finance-hub-section-head"><div><h3>사업용 통장</h3><p>계좌별 입출금과 잔액을 한 번에 확인합니다.</p></div></div>{model.bankAccounts.length ? <div className="finance-hub-assets">{model.bankAccounts.map(account => { const totals = bankTotals.get(account.id) || {}; return <article key={account.id}><span className="asset-icon bank">▤</span><div><b>{account.display_name || account.bank_name}</b><span>{account.bank_name} •••• {account.last4}</span><small>입금 {won(totals.deposit)} · 출금 {won(totals.withdrawal)}</small></div><strong>{account.balance == null ? '잔액 미수집' : won(account.balance)}</strong></article>; })}</div> : <Empty>연결된 사업용 통장이 없습니다.</Empty>}<TransactionTable rows={filteredRows.filter(row => row.type === 'bank')}/></div>}
    {tab === 'evidence' && <div className="finance-hub-panel"><div className="finance-hub-section-head"><div><h3>증빙 매칭</h3><p>거래와 영수증 연결 상태를 확인하고 검토함으로 이동합니다.</p></div><button className="submit" onClick={onOpenEvidence}>증빙 검토 열기</button></div><div className="finance-hub-match-summary"><div><span>증빙 완료</span><b>{evidenceCounts.complete || 0}건</b></div><div><span>검토 대기</span><b>{evidenceCounts.review || 0}건</b></div><div><span>미증빙</span><b>{evidenceCounts.missing || 0}건</b></div><div><span>등록 문서</span><b>{model.documents.length}건</b></div></div><TransactionTable rows={filteredRows.filter(row => row.direction === 'withdrawal' && row.evidence !== 'not_required')}/><button className="finance-hub-ledger-link" onClick={onOpenLedger}>전체 지출 원장에서 상세 원천 확인 →</button></div>}
  </section>;
}

function TransactionTable({ rows }) {
  if (!rows.length) return <Empty>조건에 맞는 거래가 없습니다.</Empty>;
  return <div className="finance-hub-table-wrap"><table className="finance-hub-table"><thead><tr><th>거래일</th><th>유형</th><th>거래처·적요</th><th>자산</th><th>카테고리</th><th>증빙</th><th>금액</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.date}</td><td><span className={`finance-hub-type ${row.type}`}>{row.sourceLabel}</span></td><td><b>{row.merchant}</b>{row.description && row.description !== row.merchant ? <small>{row.description}</small> : null}</td><td>{row.asset}</td><td><span className="finance-hub-category">{row.category}</span></td><td><span className={`finance-hub-evidence-badge ${row.evidence}`}>{evidenceLabel[row.evidence] || row.evidence}</span></td><td className={row.direction}>{row.direction === 'deposit' ? '+' : '-'}{won(row.amount)}</td></tr>)}</tbody></table></div>;
}
