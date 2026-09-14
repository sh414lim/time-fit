import React, { useEffect, useState } from 'react';
import {
  bulkConfirmExpenseMatches,
  excludeExpenseDraft,
  loadExpenseReviewQueue,
  openFinanceDocument,
  processReceiptDocument,
  reviewExpenseMatch,
  updateExpenseDraft,
} from '../../lib/supabase';

const money = value => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(Number(value) || 0);

export default function ExpenseReviewQueue({ organizationId }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`); const [to, setTo] = useState(today);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const refresh = async () => {
    if (!organizationId) return;
    setLoading(true);
    try { const next = await loadExpenseReviewQueue(organizationId, 'attention', { from, to }); setDocuments(next); const available = new Set(next.map(item => item.matches?.[0]).filter(match => match?.status === 'suggested' && Number(match.score) >= 95).map(match => match.id)); setSelectedIds(ids => ids.filter(id => available.has(id))); }
    catch (error) { setMessage(error.message || '확인 필요 영수증을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [organizationId, from, to]);

  const review = async (document, match, action) => {
    if (action === 'confirm' && !window.confirm(`${match.transaction?.merchant_name || '카드 거래'}와 영수증을 한 지출로 확정할까요?`)) return;
    setBusyId(match.id); setMessage('');
    try {
      await reviewExpenseMatch({ organizationId, matchId: match.id, action });
      setMessage(action === 'confirm' ? '카드 거래와 영수증을 하나의 지출로 확정했어요.' : action === 'unlink' ? '카드 거래 연결을 해제했어요.' : '잘못된 후보를 반려했어요.');
      await refresh();
    } catch (error) { setMessage(error.message || '검토 결과를 저장하지 못했습니다.'); }
    finally { setBusyId(''); }
  };

  const save = async (event, match) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusyId(match.expense.id); setMessage('');
    try {
      await updateExpenseDraft({ organizationId, expenseId: match.expense.id, transactionDate: form.get('transactionDate'), totalAmount: form.get('totalAmount'), merchantName: form.get('merchantName'), merchantBusinessNumber: form.get('merchantBusinessNumber'), category: form.get('category'), reason: form.get('reason'), rememberRule: form.get('rememberRule') === 'on' });
      setMessage(form.get('rememberRule') === 'on' ? '지출 정보를 수정하고 다음 영수증 자동 분류 규칙을 저장했어요.' : 'OCR 지출 정보를 수정했어요.'); await refresh();
    } catch (error) { setMessage(error.message || '지출 정보를 수정하지 못했습니다.'); }
    finally { setBusyId(''); }
  };

  const exclude = async document => {
    const expense = document.matches?.[0]?.expense || document.expense;
    if (!expense || !window.confirm('이 영수증을 지출 집계에서 제외할까요?')) return;
    setBusyId(expense.id); setMessage('');
    try { await excludeExpenseDraft({ organizationId, expenseId: expense.id }); setMessage('영수증을 지출 집계에서 제외했어요.'); await refresh(); }
    catch (error) { setMessage(error.message || '영수증을 제외하지 못했습니다.'); }
    finally { setBusyId(''); }
  };

  const openOriginal = async document => {
    try { window.open(await openFinanceDocument(document.storage_path), '_blank', 'noopener,noreferrer'); }
    catch (error) { setMessage(error.message || '영수증 원본을 열지 못했습니다.'); }
  };

  const bulkConfirm = async () => {
    if (!selectedIds.length || !window.confirm(`고신뢰 영수증 ${selectedIds.length}건을 카드 거래와 일괄 확정할까요?`)) return;
    setBusyId('bulk'); setMessage('');
    try { const result = await bulkConfirmExpenseMatches({ organizationId, matchIds: selectedIds }); setMessage(`${result.confirmed}건을 일괄 확정했어요.${result.failed ? ` 실패 ${result.failed}건은 목록에 유지됩니다.` : ''}`); setSelectedIds([]); await refresh(); }
    catch (error) { setMessage(error.message || '일괄 확정을 완료하지 못했습니다.'); }
    finally { setBusyId(''); }
  };

  const retry = async document => {
    setBusyId(document.id); setMessage('영수증을 다시 분석하고 있어요.');
    try { await processReceiptDocument({ organizationId, documentId: document.id }); setMessage('재분석을 완료했어요. 결과를 확인해 주세요.'); await refresh(); }
    catch (error) { setMessage(error.message || '영수증 재분석을 완료하지 못했습니다.'); await refresh(); }
    finally { setBusyId(''); }
  };

  return <section className="card full-card expense-review-queue">
    <div className="card-title"><div><h2>확인 필요 영수증</h2><p>OCR 결과와 카드 후보를 비교해 예외만 처리하세요. 확정하면 하나의 지출로 합쳐집니다.</p></div><span className="count">{documents.length}</span></div>
    <div className="period-query-controls"><label>시작일<input aria-label="증빙 시작일" type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label>종료일<input aria-label="증빙 종료일" type="date" min={from} value={to} onChange={event => setTo(event.target.value)}/></label><span>{from} ~ {to}</span></div>
    {documents.some(item => Number(item.matches?.[0]?.score) >= 95) && <div className="expense-bulk-review"><label><input type="checkbox" checked={selectedIds.length > 0 && selectedIds.length === documents.filter(item => item.matches?.[0]?.status === 'suggested' && Number(item.matches?.[0]?.score) >= 95).length} onChange={event => setSelectedIds(event.target.checked ? documents.map(item => item.matches?.[0]).filter(match => match?.status === 'suggested' && Number(match.score) >= 95).map(match => match.id) : [])}/><span>95점 이상 최상위 후보 전체 선택</span></label><button className="submit" disabled={!selectedIds.length || Boolean(busyId)} onClick={bulkConfirm}>{busyId === 'bulk' ? '확정 중…' : `${selectedIds.length}건 일괄 확정`}</button></div>}
    {message && <div className={/못|이미|오류/.test(message) ? 'connection-error' : 'expense-review-success'}><span>{message}</span><button onClick={() => setMessage('')}>닫기</button></div>}
    {loading ? <div className="empty-inline">영수증 검토함을 불러오는 중…</div> : documents.length ? documents.map(document => {
      const topMatch = document.matches?.[0]; const expense = topMatch?.expense || document.expense; const extracted = document.extracted_data || {}; const expanded = expandedId === document.id;
      if (document.processing_status === 'failed') return <article className="expense-review-item failed" key={document.id}><div className="expense-review-summary"><div><b>{document.title}</b><span>OCR 자동 분석 실패 · 원본은 안전하게 보관 중</span></div><div className="expense-review-actions"><button className="outline" onClick={() => openOriginal(document)}>원본 보기</button><button className="submit" disabled={Boolean(busyId)} onClick={() => retry(document)}>{busyId === document.id ? '재분석 중…' : '다시 분석'}</button></div></div><div className="receipt-processing-error"><b>실패 원인</b><span>{document.processing_error || '외부 분석 서비스 응답을 확인해 주세요.'}</span></div></article>;
      return <article className="expense-review-item" key={document.id}>
        <div className="expense-review-summary">{topMatch?.status === 'suggested' && Number(topMatch.score) >= 95 && <input className="expense-select" type="checkbox" aria-label={`${extracted.merchantName || document.title} 일괄 확정 선택`} checked={selectedIds.includes(topMatch.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...new Set([...ids, topMatch.id])] : ids.filter(id => id !== topMatch.id))}/>}<div><b>{extracted.merchantName || document.title}</b><span>{extracted.transactionDate || document.document_date || '날짜 확인 필요'} · {money(extracted.totalAmount)}</span></div><div className="expense-review-actions"><button className="outline" onClick={() => openOriginal(document)}>원본 보기</button><button className="outline" onClick={() => setExpandedId(expanded ? '' : document.id)}>{expanded ? '접기' : '검토하기'}</button></div></div>
        <div className="expense-match-summary"><span>카드 후보 <b>{document.matches?.length || 0}건</b></span>{topMatch ? <><span>{topMatch.transaction?.merchant_name || '사용처 미확인'} · {money(topMatch.transaction?.net_amount)}</span><em>{topMatch.score}점</em></> : <span>일치 후보 없음 · 직접 지출로 검토</span>}</div>
        {expanded && <div className="expense-review-detail">
          {expense && <form className="expense-review-form" onSubmit={event => save(event, { expense })}><label>사용처<input name="merchantName" defaultValue={expense.merchant_name || extracted.merchantName || ''}/></label><label>거래일<input name="transactionDate" type="date" required defaultValue={expense.transaction_date || extracted.transactionDate || ''}/></label><label>총금액<input name="totalAmount" type="number" min="0" required defaultValue={expense.total_amount || extracted.totalAmount || 0}/></label><label>사업자번호<input name="merchantBusinessNumber" defaultValue={expense.merchant_business_number || extracted.merchantBusinessNumber || ''}/></label><label>분류<select name="category" defaultValue={expense.category || ''}><option value="">분류 확인 필요</option><option value="재료비">재료비</option><option value="소모품비">소모품비</option><option value="교통비">교통비</option><option value="접대비">접대비</option><option value="공과금">공과금</option><option value="임차료">임차료</option><option value="기타">기타</option></select></label><label>지출 사유<input name="reason" defaultValue={expense.reason || ''} placeholder="예: 주방 식자재 구입"/></label><label className="expense-rule-check"><input name="rememberRule" type="checkbox"/><span>같은 가맹점은 다음부터 이 분류·사유 자동 적용</span></label><button className="outline" disabled={busyId === expense.id}>{busyId === expense.id ? '저장 중…' : 'OCR 정보 수정'}</button></form>}
          <div className="expense-match-list">{document.matches?.length ? document.matches.map(match => <div className="expense-match-candidate" key={match.id}><div><b>{match.transaction?.card?.nickname || match.transaction?.card?.issuer || '법인카드'} •••• {match.transaction?.card?.last4}</b><span>{match.transaction?.merchant_name || '-'} · {money(match.transaction?.net_amount)} · {String(match.transaction?.approved_at || '').slice(0, 10)}</span><small>금액 {match.score_breakdown?.amount || 0} · 날짜 {match.score_breakdown?.date || 0} · 승인번호 {match.score_breakdown?.approvalNumber || 0} · 카드 {match.score_breakdown?.cardLast4 || 0}</small></div><em>{match.score}점</em><button className="outline" disabled={Boolean(busyId)} onClick={() => review(document, match, 'reject')}>반려</button><button className="submit" disabled={Boolean(busyId)} onClick={() => review(document, match, match.status === 'confirmed' ? 'unlink' : 'confirm')}>{match.status === 'confirmed' ? '연결 해제' : '이 거래로 확정'}</button></div>) : <div className="empty-inline">자동으로 찾은 카드 거래가 없습니다.</div>}</div>
          <button className="outline danger-outline" disabled={Boolean(busyId) || topMatch?.status === 'confirmed'} onClick={() => exclude(document)}>지출에서 제외</button>
        </div>}
      </article>;
    }) : <div className="empty-schedule"><b>확인할 영수증이 없어요.</b><span>새 영수증이 분석되거나 매칭 예외가 생기면 여기에 표시됩니다.</span></div>}
  </section>;
}
