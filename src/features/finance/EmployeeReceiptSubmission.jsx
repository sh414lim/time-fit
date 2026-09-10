import React, { useEffect, useRef, useState } from 'react';
import { loadMyExpenseReceiptReminders, loadMyReceiptDocuments, markExpenseReceiptReminderRead, processReceiptDocument, uploadFinanceDocument } from '../../lib/supabase';
import { inspectReceiptImage } from './receiptQuality';

const statusLabel = status => ({ not_requested: '분석 대기', queued: '분석 대기', processing: '분석 중', review_required: '관리자 확인 중', matched: '카드 내역 연결', failed: '분석 확인 필요' }[status] || status);
const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;

export default function EmployeeReceiptSubmission({ organizationId, employee }) {
  const [documents, setDocuments] = useState([]); const [reminders, setReminders] = useState([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const fileRef = useRef(null);
  const refresh = async () => {
    if (!organizationId || !employee?.id) return;
    const [nextDocuments, nextReminders] = await Promise.all([loadMyReceiptDocuments(organizationId), loadMyExpenseReceiptReminders(organizationId, employee.id)]);
    setDocuments(nextDocuments); setReminders(nextReminders);
  };
  useEffect(() => { refresh().catch(error => setMessage(error.message || '영수증 제출 내역을 불러오지 못했습니다.')); }, [organizationId, employee?.id]);
  const submit = async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get('receipt');
    if (!file?.size) return setMessage('촬영한 영수증 또는 사진을 선택해 주세요.');
    if (!String(file.type || '').startsWith('image/')) return setMessage('JPG, PNG, WebP 또는 HEIC 이미지로 제출해 주세요.');
    const qualityIssues = await inspectReceiptImage(file);
    if (qualityIssues.length && !window.confirm(`${qualityIssues.map(issue => `• ${issue.message}`).join('\n')}\n\n그래도 이 사진을 제출할까요?`)) { setMessage('더 선명한 영수증 사진을 촬영해 주세요.'); return; }
    setBusy(true); setMessage('영수증 원본을 안전하게 업로드하고 있어요.');
    try {
      const reason = String(form.get('reason') || '').trim();
      const document = await uploadFinanceDocument({ organizationId, documentType: 'receipt', title: `${new Date().toLocaleDateString('ko-KR')} ${employee.name || '직원'} 영수증`, file, memo: reason, staffId: employee.id, submissionReason: reason });
      setMessage('문자를 인식하고 카드 승인내역과 대조하고 있어요.');
      const result = await processReceiptDocument({ organizationId, documentId: document.id });
      setMessage(result.duplicateReceipt ? '이미 제출된 영수증을 확인해 기존 지출에 연결했어요.' : `제출 완료 · ${result.extracted?.merchantName || '사용처 확인 중'} ${money(result.extracted?.totalAmount)}`);
      event.currentTarget.reset(); await refresh();
    } catch (error) { setMessage(error.message || '영수증을 제출하지 못했습니다. 원본 저장 여부를 관리자에게 확인해 주세요.'); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  };
  const read = async reminder => { if (reminder.status === 'read') return; try { await markExpenseReceiptReminderRead(reminder.id); setReminders(items => items.map(item => item.id === reminder.id ? { ...item, status: 'read' } : item)); } catch (error) { setMessage(error.message || '알림을 확인 처리하지 못했습니다.'); } };
  if (!employee) return <section className="card full-card empty-schedule"><b>직원 연결이 필요해요.</b><span>관리자에게 현재 로그인 계정과 직원 정보를 연결해 달라고 요청해 주세요.</span></section>;
  return <>
    <div className="page-title"><div><p>촬영 한 번으로 증빙 제출</p><h1>내 영수증</h1><span>원본을 올리면 문자 인식과 카드 내역 대조가 자동으로 진행됩니다.</span></div></div>
    {reminders.some(item => item.status === 'sent') && <section className="receipt-reminder-panel"><div><b>제출하지 않은 영수증이 있어요</b><span>카드 사용 내역을 확인하고 해당 영수증을 촬영해 주세요.</span></div>{reminders.filter(item => item.status === 'sent').map(item => <button key={item.id} onClick={() => read(item)}><span>{item.message}</span><em>{item.reminder_number}차 알림 · 확인</em></button>)}</section>}
    <section className="card full-card employee-receipt-card"><div className="card-title"><div><h2>영수증 촬영·업로드</h2><p>빛 반사가 없고 네 모서리와 결제금액이 보이게 촬영하면 인식률이 높아집니다.</p></div></div><form onSubmit={submit}><label className="receipt-camera-input"><input ref={fileRef} name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" required/><strong>카메라로 촬영 또는 사진 선택</strong><span>이미지 한 장 · 최대 20MB</span></label><label>지출 목적 <input name="reason" maxLength="200" placeholder="선택 입력 · 예: 주방 식자재 구입"/></label><button className="cta" disabled={busy}>{busy ? '업로드·분석 중…' : '영수증 제출'}</button></form>{message && <p className={/못|필요|확인/.test(message) ? 'receipt-submit-message error' : 'receipt-submit-message'}>{message}</p>}</section>
    <section className="card full-card"><div className="card-title"><div><h2>최근 제출 내역</h2><p>관리자 확인과 카드 연결 상태를 확인할 수 있습니다.</p></div><span className="count">{documents.length}</span></div>{documents.length ? <div className="employee-receipt-history">{documents.map(item => <article key={item.id}><div><b>{item.extracted_data?.merchantName || item.title}</b><span>{new Date(item.created_at).toLocaleString('ko-KR')}{item.extracted_data?.totalAmount ? ` · ${money(item.extracted_data.totalAmount)}` : ''}</span></div><em className={item.processing_status}>{statusLabel(item.processing_status)}</em></article>)}</div> : <div className="empty-schedule"><b>아직 제출한 영수증이 없어요.</b><span>법인카드를 사용했다면 결제 직후 촬영해 주세요.</span></div>}</section>
  </>;
}
