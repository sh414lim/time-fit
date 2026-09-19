import React, { useEffect, useMemo, useState } from 'react';
import { addDays, attendanceIssues, changePercent, kstDate, lastCompleteWeek, validAttendanceCorrection } from '../../../shared/operations.js';
import { correctAttendance, loadOperations } from './operationsApi';

const number = value => Math.round(value).toLocaleString('ko-KR');
const money = value => `${number(value)}원`;
const time = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 없음';
const issueLabels = { checkout: '퇴근 기록 누락', absent: '예정 근무의 출근 기록 없음', schedule: '근무 일정과 기록 불일치' };
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  return now;
}
function useOperations(organizationId, scope, filters, enabled = true, refreshToken = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(filters);
  const identity = `${organizationId}:${scope}:${key}:${enabled}`;
  useEffect(() => {
    if (!enabled) { setState({ data: null, loading: false, error: '' }); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setState({ data: null, loading: false, error: '조회 시간이 초과됐습니다. 다시 시도해 주세요.', identity }); }, 30000);
    setState({ data: null, loading: true, error: '' });
    loadOperations(organizationId, scope, JSON.parse(key), controller.signal).then(data => {
      clearTimeout(timeout);
      if (!controller.signal.aborted) setState({ data, loading: false, error: '', identity });
    }).catch(error => { clearTimeout(timeout); if (!controller.signal.aborted) setState({ data: null, loading: false, error: error.message, identity }); });
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [organizationId, scope, key, enabled, revision, refreshToken]);
  return { ...(state.identity === identity ? state : { data: null, loading: enabled, error: '' }), refresh: () => setRevision(value => value + 1) };
}
function LoadState({ resource, label }) {
  return resource.loading ? <p className="ops-status" role="status">{label} 불러오는 중…</p> : resource.error ? <div className="ops-status ops-error" role="alert"><span>{resource.error}</span><button className="outline" onClick={resource.refresh}>다시 시도</button></div> : null;
}
function Task({ title, value, description, onClick }) {
  return <button className="ops-task" onClick={onClick}><span><b>{title}</b><small>{description}</small></span><strong>{value}</strong><span aria-hidden="true">›</span></button>;
}

export function OperationsHome({ employees, leaves, organizationId, isOwner, canAttendance, canLeave, onNavigate, dataError }) {
  const now = useNow(), today = kstDate(now), month = today.slice(0, 7);
  const from = `${month}-01`, to = addDays(today, -1);
  const issues = useMemo(() => attendanceIssues(employees, { from, to, now, leaves }), [employees, from, to, now, leaves]);
  const finance = useOperations(organizationId, 'tasks', { month }, isOwner);
  const count = type => issues.filter(issue => issue.types.includes(type)).length;
  const openIssues = type => onNavigate('attendance', { issueType: type, from, to });
  const pending = leaves.filter(row => row.status === '승인 대기');
  return <div className="ops-workspace">
    <section className="card ops-card"><div className="ops-heading"><div><p className="ops-eyebrow">매장 운영</p><h2>확인할 일</h2><p>{month} · 근태는 어제까지의 기록</p></div><span className="ops-tag">실제 기록 기준</span></div>
      {dataError && <p className="ops-warning" role="alert">근태·휴가 데이터를 갱신하지 못해 확인 건수를 표시하지 않습니다. 화면 상단에서 다시 시도해 주세요.</p>}{canAttendance && !dataError && <><Task title="퇴근 기록 누락" value={`${count('checkout')}건`} description="근무가 끝난 기록의 퇴근 시각을 확인해 주세요." onClick={() => openIssues('checkout')}/><details className="ops-more"><summary>다른 근태 확인 항목 · {issues.filter(issue => issue.types.some(type => type !== 'checkout')).length}개 기록</summary><Task title="예정 근무의 출근 기록 없음" value={`${count('absent')}건`} description="승인된 근무 일정과 실제 출근을 대조합니다." onClick={() => openIssues('absent')}/><Task title="근무 일정과 기록 불일치" value={`${count('schedule')}건`} description="승인된 근무가 없거나 휴무일에 출근 기록이 있습니다." onClick={() => openIssues('schedule')}/><p className="ops-note">같은 기록이 여러 항목에 포함될 수 있습니다. 결근·추가 근무로 확정한 수치가 아닙니다.</p></details></>}
      {isOwner && <><LoadState resource={finance} label="급여·카드 현황"/>{finance.data && <><Task title={`${month} 급여 초안`} value={!finance.data.draft ? '미작성' : finance.data.attendanceChanged ? '재검토' : '저장됨'} description={finance.data.draft ? `${time(finance.data.draft.updated_at)} 저장 · 정산 전 근태와 계약을 확인해 주세요.` : '근태 확인 후 급여 관리에서 초안을 저장하세요.'} onClick={() => onNavigate('payroll', { month })}/><Task title="미검토 카드 내역" value={`${finance.data.cardCount}건`} description={`${month} · ${money(finance.data.cardAmount)} · 확정 지출에 포함되지 않은 검토 대상`} onClick={() => onNavigate('documents', { cardReview: true, month })}/></> }</>}
      {canLeave && !dataError && <Task title="휴가 승인 대기" value={`${pending.length}건`} description="직원이 제출한 요청을 확인해 주세요." onClick={() => onNavigate('leave')}/>}
      {!canAttendance && !canLeave && !isOwner && <p className="ops-status">조회 권한이 있는 메뉴에서 업무를 확인해 주세요.</p>}
    </section>
    {isOwner && <WeeklyFeedback organizationId={organizationId} onNavigate={onNavigate}/>}
  </div>;
}

export function WeeklyFeedback({ organizationId, detailed = false, initialFrom, onNavigate, refreshToken }) {
  const today = kstDate(useNow()), latest = lastCompleteWeek(today);
  const [selectedFrom, setSelectedFrom] = useState(initialFrom || latest.from);
  const from = detailed ? selectedFrom : latest.from;
  const [tab, setTab] = useState('sales');
  const resource = useOperations(organizationId, 'weekly', { from }, true, refreshToken);
  const data = resource.data;
  const delta = (current, previous) => {
    if (!data.comparable) return '전주 비교 보류';
    const change = changePercent(current, previous);
    return change === null ? '전주 기준값 없음' : `전주 대비 ${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
  };
  return <section className="card ops-card ops-weekly">
    <div className="ops-heading"><div><p className="ops-eyebrow">매주 월요일 · 마감된 주 비교</p><h2>{detailed ? '주간 매출 분석' : '지난주 매장 요약'}</h2><p>{from} ~ {addDays(from, 6)}<br/>비교 기간 {addDays(from, -7)} ~ {addDays(from, -1)}</p></div>{detailed ? <button className="outline" disabled={resource.loading} onClick={resource.refresh}>새로고침</button> : <button className="outline" onClick={() => onNavigate('sales', { from })}>자세히 보기 →</button>}</div>
    {detailed && <div className="ops-controls"><button className="outline" onClick={() => setSelectedFrom(addDays(from, -7))}>← 이전 주</button><button className="outline" disabled={from >= latest.from} onClick={() => setSelectedFrom(addDays(from, 7))}>다음 주 →</button><button className="outline" disabled={from === latest.from} onClick={() => setSelectedFrom(latest.from)}>지난주</button></div>}
    <LoadState resource={resource} label="주간 매출"/>
    {data && (!data.connected ? <p className="ops-status">연결된 매출 데이터가 없습니다. 운영 설정에서 POS 연결을 확인해 주세요.</p> : <>
      <p className="ops-note">마지막 수집 {time(data.syncedAt)} · 저장된 완료 주문 기준{data.syncError ? ' · 최근 수집 오류가 있습니다.' : ''}</p>
      {!data.comparable && <p className="ops-warning">일부 날짜의 수집 내역을 확인할 수 없어 전주 비교를 보류했습니다. 아래는 현재 저장된 주문의 합계입니다.</p>}
      <div className="ops-metrics">{[['완료 매출', money(data.current.revenue), data.current.revenue, data.previous.revenue], ['완료 주문', `${number(data.current.orders)}건`, data.current.orders, data.previous.orders], ['주문당 금액', data.current.average === null ? '—' : money(data.current.average), data.current.average, data.previous.average]].map(([label, value, current, previous]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{current === null ? '완료 주문 없음' : delta(current, previous)}</small></article>)}</div>
      {data.comparable && data.current.orders > 0 && <p className="ops-insight">{data.current.revenue > data.previous.revenue && data.current.average < data.previous.average ? '주문 수 증가와 함께 매출이 늘었지만 주문당 금액는 낮아졌습니다. 메뉴별 판매 구성을 확인해 보세요.' : '같은 요일로 구성된 두 주의 결과입니다. 일별 매출과 메뉴 수량을 함께 확인해 보세요.'}</p>}
      {detailed && <div className="ops-tabs" aria-label="매출 상세 보기"><button aria-pressed={tab === 'sales'} onClick={() => setTab('sales')}>일별 매출</button><button aria-pressed={tab === 'menus'} onClick={() => setTab('menus')}>메뉴 판매</button></div>}
      {detailed && tab === 'sales' && <div className="ops-days"><p className="ops-note">진한색 이번 주 · 옅은색 비교 주{!data.comparable ? ' (비교 보류)' : ''}</p>{data.current.days.map((day, index) => {
        const max = Math.max(1, ...data.current.days.map(row => row.revenue), ...(data.comparable ? data.previous.days.map(row => row.revenue) : []));
        return <div className="ops-day" key={day.date}><b>{['월','화','수','목','금','토','일'][index]}<small>{day.date.slice(5)}</small></b><div><div className="ops-bar"><i style={{ width: `${day.revenue / max * 100}%` }}/><span>{money(day.revenue)}{!day.covered ? ' · 수집 확인 필요' : ''}</span></div>{data.comparable && <div className="ops-bar previous"><i style={{ width: `${data.previous.days[index].revenue / max * 100}%` }}/><span>{money(data.previous.days[index].revenue)}</span></div>}</div></div>;
      })}</div>}
      {(!detailed || tab === 'menus') && <div className="ops-menus"><h3>판매 수량 상위 메뉴</h3><p className="ops-note">유료 메뉴 수량 기준 · 같은 이름은 합산 · 무료 옵션 제외</p>{!data.menuComparable && <p className="ops-note">메뉴 비교에 필요한 주문 상세가 부족하면 증감을 표시하지 않습니다.</p>}{data.menus.length ? data.menus.map((menu, index) => <div className="ops-menu" key={menu.name}><span>{index + 1}</span><b>{menu.name}</b><strong>{number(menu.quantity)}개</strong><small>{menu.previous === null ? '비교 보류' : `전주 ${number(menu.previous)}개 · ${menu.quantity - menu.previous > 0 ? '+' : ''}${number(menu.quantity - menu.previous)}개`}</small></div>) : <p className="ops-status">표시할 유료 메뉴 내역이 없습니다.</p>}</div>}
      <p className="ops-note">실시간 매출이나 순이익이 아닙니다. 취소 주문은 제외하며, POS 수집 지연·누락은 원본과 확인이 필요합니다.</p>
    </>)}
  </section>;
}

export function AttendanceIssueList({ employees, leaves, organizationId, context, canCorrect, onRefresh, onBack, onOpenSchedule }) {
  const now = useNow();
  const [type, setType] = useState(context.issueType);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(context.page || 0);
  const [notice, setNotice] = useState('');
  const issues = attendanceIssues(employees, { from: context.from, to: context.to, now, leaves });
  const rows = issues.filter(issue => issue.types.includes(type));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  return <div className="ops-workspace"><button className="ops-back" onClick={onBack}>← {context.returnTo?.id === 'payroll' ? '급여 관리로' : '홈으로'}</button><section className="card ops-card"><div className="ops-heading"><div><p className="ops-eyebrow">근태 확인</p><h1>{issueLabels[type]}</h1><p>{context.from} ~ {context.to} · {rows.length}건</p></div><button className="outline" onClick={async () => { try { await onRefresh(); setNotice('최신 기록을 불러왔습니다.'); } catch { setNotice('새로고침하지 못했습니다. 이전 기록을 표시합니다.'); } }}>새로고침</button></div><div className="ops-tabs">{Object.entries(issueLabels).map(([key, label]) => <button aria-pressed={type === key} onClick={() => { setType(key); setPage(0); setSelected(null); }} key={key}>{label} ({issues.filter(issue => issue.types.includes(key)).length})</button>)}</div><p className="ops-note">조회만으로 항목이 사라지지 않습니다. 실제 출퇴근 또는 승인된 스케줄이 수정되면 다시 계산합니다.</p>{notice && <p role="status" className="ops-warning">{notice}</p>}{selected ? <AttendanceCorrection key={selected.key} issue={selected} organizationId={organizationId} canCorrect={canCorrect} onOpenSchedule={() => onOpenSchedule?.(selected, { issueType: type, page: currentPage })} onClose={() => setSelected(null)} onSaved={async () => { setNotice('정정 기록을 저장했습니다.'); setSelected(null); try { await onRefresh(); } catch { setNotice('저장은 완료됐지만 목록 갱신에 실패했습니다. 새로고침해 주세요.'); } }}/>: <>{rows.slice(currentPage * 10, currentPage * 10 + 10).map(issue => <button className="ops-task" key={issue.key} onClick={() => setSelected(issue)}><span><b>{issue.employee.name} · {issue.date}</b><small>{issue.employee.team} · 출근 {time(issue.record?.checked_in_at)} · 퇴근 {time(issue.record?.checked_out_at)}</small><small>{issue.schedule?.is_day_off ? '승인 일정: 휴무' : issue.schedule ? `예정 ${issue.schedule.starts_at?.slice(0, 5)}–${issue.schedule.ends_at?.slice(0, 5)}` : '승인된 근무 일정 없음'}</small></span><strong>기록 확인 ›</strong></button>)}{!rows.length && <p className="ops-status">이 기간에 해당하는 확인 항목이 없습니다.</p>}{rows.length > 10 && <div className="ops-controls"><button className="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage + 1} / {Math.ceil(rows.length / 10)}</span><button className="outline" disabled={(currentPage + 1) * 10 >= rows.length} onClick={() => setPage(currentPage + 1)}>다음</button></div>}</>}</section></div>;
}
function AttendanceCorrection({ issue, organizationId, canCorrect, onClose, onSaved, onOpenSchedule }) {
  const local = value => value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19) : '';
  const [checkedIn, setCheckedIn] = useState(local(issue.record?.checked_in_at));
  const [checkedOut, setCheckedOut] = useState(local(issue.record?.checked_out_at));
  const [reason, setReason] = useState(''), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async event => {
    event.preventDefault(); setError('');
    if (!validAttendanceCorrection({ date: issue.date, checkedIn, checkedOut, reason, requireCheckout: issue.types.includes('checkout') })) { setError('출근 날짜, 퇴근 시각, 정정 사유를 확인해 주세요.'); return; }
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try { await correctAttendance({ organizationId, issue, checkedIn, checkedOut, reason }); await onSaved(); }
    catch (next) { setError(next.message || '정정 기록을 저장하지 못했습니다.'); setConfirm(false); }
    finally { setBusy(false); }
  };
  return <div className="ops-correction"><button className="ops-back" disabled={busy} onClick={onClose}>← 확인 목록</button><h2>{issue.employee.name} · {issue.date}</h2><p>기존 출근 {time(issue.record?.checked_in_at)} / 퇴근 {time(issue.record?.checked_out_at)}</p>{issue.types.includes('schedule') && <p className="ops-warning">출퇴근 시각이 맞다면 스케줄 관리에서 해당 날짜의 근무를 확인하세요. 기록 정정만으로 일정 불일치가 해소되지는 않습니다.{canCorrect && onOpenSchedule && <button type="button" className="outline" disabled={busy} onClick={onOpenSchedule}>이 날짜 스케줄 확인</button>}</p>}{canCorrect ? <form onSubmit={save}><fieldset disabled={busy || confirm}><label>출근 시각 (한국 시간)<input type="datetime-local" step="1" required value={checkedIn} onChange={event => setCheckedIn(event.target.value)}/></label><label>퇴근 시각 (한국 시간)<input type="datetime-local" step="1" required={issue.types.includes('checkout')} value={checkedOut} onChange={event => setCheckedOut(event.target.value)}/></label><label>정정 사유<textarea required minLength={2} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="실제 근무 사실을 확인한 근거를 남겨 주세요."/></label></fieldset>{confirm && <p className="ops-warning">위 시각으로 실제 근태를 정정합니다. 기존 값과 정정 사유가 이력에 남으며, 급여 초안은 별도로 다시 검토해야 합니다.</p>}{error && <p role="alert" className="ops-error">{error}</p>}<div className="ops-controls">{confirm && <button type="button" className="outline" disabled={busy} onClick={() => setConfirm(false)}>다시 수정</button>}<button className="submit" disabled={busy}>{busy ? '저장 중…' : confirm ? '정정 내용 저장' : '정정 내용 확인'}</button></div></form> : <p className="ops-note">조회 권한으로 열었습니다. 정정은 최고관리자에게 요청해 주세요.</p>}</div>;
}

export function CardReviewList({ organizationId, month, onBack }) {
  const resource = useOperations(organizationId, 'cards', { month });
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState(null);
  const rows = resource.data?.cards || [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  return <div className="ops-workspace"><button className="ops-back" onClick={onBack}>← 홈으로</button><section className="card ops-card"><div className="ops-heading"><div><p className="ops-eyebrow">지출 · 증빙</p><h1>미검토 카드 내역</h1><p>{month} · 승인·취소를 합친 거래 단위</p></div><button className="outline" disabled={resource.loading} onClick={resource.refresh}>새로고침</button></div><LoadState resource={resource} label="미검토 카드"/>{resource.data && <><p className="ops-warning">{rows.length}건 · {money(rows.reduce((sum, row) => sum + Number(row.net_amount), 0))} — 검토 전 카드 사용액이며 확정 지출이 아닙니다.</p>{rows.slice(currentPage * 10, currentPage * 10 + 10).map(row => <div key={row.id}><button className="ops-task" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}><span><b>{row.merchant_name || '사용처 미등록'}</b><small>{time(row.approved_at)} · {row.card?.nickname || '카드'} ••••{row.card?.last4}</small></span><strong>{money(row.net_amount)}</strong><span aria-hidden="true">⌄</span></button>{expanded === row.id && <div className="ops-card-detail"><b>증빙 대조가 필요합니다</b><p>아래 증빙 관리에서 영수증을 등록한 뒤 카드 후보와 대조·확정해 주세요. 상세 조회만으로 검토가 완료되지는 않습니다.</p><button className="outline" onClick={() => document.querySelector('.expense-review-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>증빙 검토함으로 이동</button></div>}</div>)}{!rows.length && <p className="ops-status">이 달의 미검토 카드 내역이 없습니다.</p>}{rows.length > 10 && <div className="ops-controls"><button className="outline" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>이전</button><span>{currentPage + 1} / {Math.ceil(rows.length / 10)}</span><button className="outline" disabled={(currentPage + 1) * 10 >= rows.length} onClick={() => setPage(currentPage + 1)}>다음</button></div>}</>}</section></div>;
}
