import React, { useEffect, useMemo, useState } from 'react';
import {
  confirmReceiptSubmission,
  createReceiptSubmission,
  loadCostCenters,
  loadMyExpenseReceiptReminders,
  loadMyReceiptDocuments,
  loadReceiptSubmission,
  markExpenseReceiptReminderRead,
  processReceiptDocument,
} from '../../lib/supabase';
import { inspectReceiptImage, prepareReceiptFiles } from './receiptQuality';

const processing = new Set(['uploaded','queued','processing']);
const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
const statusInfo = item => {
  if (item.review_status === 'approved') return ['처리 완료','complete'];
  if (item.review_status === 'change_requested') return ['수정 요청이 왔어요','attention'];
  if (item.review_status === 'submitter_review') return ['내용 확인 필요','attention'];
  if (item.review_status === 'manager_review' || item.review_status === 'resubmitted') return ['관리자 확인 중','review'];
  if (item.processing_status === 'failed') return ['자동 인식 확인 필요','attention'];
  if (processing.has(item.processing_status)) return ['내용 확인 중','processing'];
  return ['제출 접수','submitted'];
};

function centerLabel(center, centers) {
  if (!center) return '부서·섹션 미선택';
  const parent = centers.find(item => item.id === center.parent_id);
  return parent ? `${parent.name} > ${center.name}` : center.name;
}

function ReceiptCorrection({ detail, centers, busy, onClose, onConfirm }) {
  const document = detail.document; const extracted = document.extracted_data || {};
  const validation = detail.extraction?.validation_result || {};
  return <section className="receipt-result-review" aria-labelledby="receipt-result-title">
    <div className="receipt-result-head"><div><b id="receipt-result-title">인식 결과를 확인해 주세요</b><span>확실하지 않은 값만 수정하면 관리자에게 전달됩니다.</span></div><button type="button" className="outline" onClick={onClose}>닫기</button></div>
    {document.change_request_reason && <p className="receipt-change-reason"><b>관리자 요청</b>{document.change_request_reason}</p>}
    {validation.lineItemDifference !== null && validation.lineItemDifference !== 0 && <p className="receipt-validation-warning">품목 합계와 영수증 총액의 차이 {money(validation.lineItemDifference)}를 확인해 주세요.</p>}
    <form onSubmit={onConfirm}>
      <label>사용처<input name="merchantName" required defaultValue={extracted.merchantName || ''}/></label>
      <label>거래일<input name="transactionDate" type="date" required defaultValue={extracted.transactionDate || ''}/></label>
      <label>총금액<input name="totalAmount" type="number" min="1" step="1" required defaultValue={extracted.totalAmount || ''}/></label>
      <label>부서·섹션<select name="costCenterId" required defaultValue={document.cost_center_id || ''}><option value="">선택</option>{centers.map(center => <option key={center.id} value={center.id}>{centerLabel(center, centers)}</option>)}</select></label>
      <label>결제수단<select name="paymentMethod" required defaultValue={document.payment_method || extracted.paymentMethod || ''}><option value="">선택</option><option value="corporate_card">법인카드</option><option value="personal_card">개인카드</option><option value="cash">현금</option><option value="bank_transfer">계좌이체</option><option value="other">기타</option></select></label>
      {detail.lineItems?.length > 0 && <div className="receipt-line-preview"><b>인식 품목 {detail.lineItems.length}개</b>{detail.lineItems.slice(0,8).map(item => <span key={item.id}>{item.item_name_raw || item.raw_text}<em>{item.line_amount === null ? '금액 확인' : money(item.line_amount)}</em></span>)}{detail.lineItems.length > 8 && <small>외 {detail.lineItems.length - 8}개 품목</small>}</div>}
      <button className="cta" disabled={busy}>{busy ? '저장 중…' : '수정 내용 제출'}</button>
    </form>
  </section>;
}

export default function EmployeeReceiptSubmission({ organizationId, employee }) {
  const [documents, setDocuments] = useState([]); const [reminders, setReminders] = useState([]); const [centers, setCenters] = useState([]);
  const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [detail, setDetail] = useState(null);
  const previews = useMemo(() => files.map(file => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);
  const refresh = async () => {
    if (!organizationId || !employee?.id) return;
    const [nextDocuments, nextReminders, nextCenters] = await Promise.all([loadMyReceiptDocuments(organizationId), loadMyExpenseReceiptReminders(organizationId, employee.id), loadCostCenters(organizationId)]);
    setDocuments(nextDocuments); setReminders(nextReminders); setCenters(nextCenters);
  };
  useEffect(() => { refresh().catch(error => setMessage(error.message || '영수증 제출 내역을 불러오지 못했습니다.')); }, [organizationId, employee?.id]);
  useEffect(() => {
    if (!documents.some(item => processing.has(item.processing_status))) return undefined;
    const timer = window.setInterval(() => refresh().catch(() => {}), 5000); return () => window.clearInterval(timer);
  }, [documents.map(item => `${item.id}:${item.processing_status}:${item.review_status}`).join('|')]);
  const defaultCenterId = centers.find(center => center.staff_category_id === employee?.categoryId)?.id || centers[0]?.id || '';
  const selectFiles = async event => {
    const selected = Array.from(event.target.files || []).slice(0,20); if (!selected.length) return;
    setBusy(true); setMessage('OCR에 맞게 사진을 준비하고 있어요.');
    try { const next = await prepareReceiptFiles(selected); const issues = (await Promise.all(next.map(inspectReceiptImage))).flat(); setFiles(next); setMessage(issues.length ? issues[0].message : '사진을 확인한 뒤 부서와 결제수단을 선택해 주세요.'); }
    catch (error) { setFiles([]); event.target.value = ''; setMessage(error.message || '영수증 사진을 준비하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const submit = async event => {
    event.preventDefault(); if (!files.length) return setMessage('촬영한 영수증 또는 사진을 선택해 주세요.');
    const form = new FormData(event.currentTarget); setBusy(true); setMessage('영수증 원본을 안전하게 저장하고 있어요.');
    try {
      const document = await createReceiptSubmission({ organizationId, files, costCenterId: form.get('costCenterId'), paymentMethod: form.get('paymentMethod'), staffId: employee.id, submissionReason: String(form.get('reason') || '').trim() });
      await processReceiptDocument({ organizationId, documentId: document.id });
      setFiles([]); event.currentTarget.reset(); setMessage('제출 접수 완료 · 문자와 기본 결제정보를 확인하는 동안 다른 업무를 계속할 수 있어요.'); await refresh();
    } catch (error) { setMessage(error.message || '영수증을 제출하지 못했습니다. 원본 저장 여부를 관리자에게 확인해 주세요.'); }
    finally { setBusy(false); }
  };
  const openDetail = async document => { setBusy(true); try { setDetail(await loadReceiptSubmission({ organizationId, documentId: document.id })); } catch (error) { setMessage(error.message || '인식 결과를 불러오지 못했습니다.'); } finally { setBusy(false); } };
  const confirm = async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try { await confirmReceiptSubmission({ organizationId, documentId: detail.document.id, patch: { merchantName: form.get('merchantName'), transactionDate: form.get('transactionDate'), totalAmount: form.get('totalAmount'), costCenterId: form.get('costCenterId'), paymentMethod: form.get('paymentMethod') } }); setDetail(null); setMessage('수정 내용을 저장했어요. 카드 내역을 다시 대조하고 있습니다.'); await refresh(); }
    catch (error) { setMessage(error.message || '수정 내용을 저장하지 못했습니다.'); } finally { setBusy(false); }
  };
  const read = async reminder => { if (reminder.status === 'read') return; try { await markExpenseReceiptReminderRead(reminder.id); setReminders(items => items.map(item => item.id === reminder.id ? { ...item, status: 'read' } : item)); } catch (error) { setMessage(error.message || '알림을 확인 처리하지 못했습니다.'); } };
  if (!employee) return <section className="card full-card empty-schedule"><b>직원 연결이 필요해요.</b><span>관리자에게 현재 로그인 계정과 직원 정보를 연결해 달라고 요청해 주세요.</span></section>;
  return <>
    <div className="page-title"><div><p>촬영하고 필요한 값만 확인</p><h1>내 영수증</h1><span>원본 저장 후 문자와 기본 결제정보 인식, 카드 대조는 백그라운드에서 진행됩니다.</span></div></div>
    {reminders.some(item => item.status === 'sent') && <section className="receipt-reminder-panel"><div><b>제출하지 않은 영수증이 있어요</b><span>카드 사용 내역을 확인하고 해당 영수증을 촬영해 주세요.</span></div>{reminders.filter(item => item.status === 'sent').map(item => <button key={item.id} onClick={() => read(item)}><span>{item.message}</span><em>{item.reminder_number}차 알림 · 확인</em></button>)}</section>}
    {detail && <ReceiptCorrection detail={detail} centers={centers} busy={busy} onClose={() => setDetail(null)} onConfirm={confirm}/>}
    <section className="card full-card employee-receipt-card"><div className="card-title"><div><h2>영수증 촬영·업로드</h2><p>네 모서리와 결제금액이 보이게 촬영해 주세요. 긴 영수증은 페이지를 추가할 수 있습니다.</p></div></div>
      <form onSubmit={submit}>
        <label className="receipt-camera-input"><input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple onChange={selectFiles}/><strong>{files.length ? `${files.length}장 선택됨` : '카메라로 촬영 또는 사진 선택'}</strong><span>최대 20장 · HEIC와 큰 사진은 OCR용 JPG로 자동 최적화</span></label>
        {previews.length > 0 && <div className="receipt-preview-strip">{previews.map((item,index) => <figure key={`${item.file.name}-${index}`}><img src={item.url} alt={`영수증 ${index + 1}페이지 미리보기`}/><figcaption>{index + 1}페이지</figcaption></figure>)}<button type="button" className="outline" onClick={() => setFiles([])}>다시 선택</button></div>}
        <div className="receipt-submit-fields"><label>부서·섹션<select name="costCenterId" required defaultValue={defaultCenterId} key={defaultCenterId}><option value="">선택</option>{centers.map(center => <option key={center.id} value={center.id}>{centerLabel(center, centers)}</option>)}</select></label><label>결제수단<select name="paymentMethod" required defaultValue="corporate_card"><option value="corporate_card">법인카드</option><option value="personal_card">개인카드</option><option value="cash">현금</option><option value="bank_transfer">계좌이체</option><option value="other">기타</option></select></label><label>지출 목적 <input name="reason" maxLength="200" placeholder="선택 · 예: 주방 식자재 구입"/></label></div>
        <button className="cta receipt-submit-button" disabled={busy || !files.length}>{busy ? '원본 저장 중…' : '영수증 제출'}</button>
      </form>{message && <p className={/못|필요|확인|낮|흐|어두|반사/.test(message) ? 'receipt-submit-message error' : 'receipt-submit-message'}>{message}</p>}
    </section>
    <section className="card full-card"><div className="card-title"><div><h2>최근 제출</h2><p>확인이 필요한 영수증이 먼저 표시됩니다.</p></div><span className="count">{documents.length}</span></div>{documents.length ? <div className="employee-receipt-history">{[...documents].sort((a,b) => Number(['submitter_review','change_requested'].includes(b.review_status)) - Number(['submitter_review','change_requested'].includes(a.review_status)) || new Date(b.created_at) - new Date(a.created_at)).map(item => { const [label,tone] = statusInfo(item); const needsAction = ['submitter_review','change_requested'].includes(item.review_status) || item.processing_status === 'failed'; return <article key={item.id} className={needsAction ? 'needs-action' : ''}><div><b>{item.extracted_data?.merchantName || item.title}</b><span>{new Date(item.created_at).toLocaleString('ko-KR')}{item.extracted_data?.totalAmount ? ` · ${money(item.extracted_data.totalAmount)}` : ''}{item.page_count > 1 ? ` · ${item.page_count}장` : ''}</span>{item.change_request_reason && <small>{item.change_request_reason}</small>}</div><div className="receipt-history-actions"><em className={tone}>{label}</em>{needsAction && <button className="outline" disabled={busy} onClick={() => openDetail(item)}>내용 확인</button>}</div></article>; })}</div> : <div className="empty-schedule"><b>아직 제출한 영수증이 없어요.</b><span>결제 직후 촬영하면 누락 없이 처리할 수 있습니다.</span></div>}</section>
  </>;
}
