import React, { useEffect, useState } from 'react';
import {
  createFeedbackItem,
  createMeetingNote,
  loadFeedbackItems,
  loadMeetingNotes,
  updateFeedbackItem,
} from '../../lib/supabase';

const koreanDateTime = value => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

export default function ComplaintWorkspace({ organizationId }) {
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = () => {
    setLoading(true);
    return Promise.all([loadFeedbackItems(organizationId), loadMeetingNotes(organizationId)])
      .then(([feedback, meetings]) => {
        setItems(feedback.filter(item => item.source === 'internal' && ['complaint', 'suggestion'].includes(item.kind)));
        setNotes(meetings);
      })
      .catch(error => setMessage(error.message || '컴플레인을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (organizationId) refresh(); }, [organizationId]);

  const submitComplaint = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await createFeedbackItem({ organization_id: organizationId, kind: form.get('kind'), author_name: form.get('author') || null, content: form.get('content'), occurred_at: new Date().toISOString() });
      event.currentTarget.reset();
      setMessage('컴플레인을 등록했습니다.');
      await refresh();
    } catch (error) { setMessage(error.message || '컴플레인을 등록하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const resolve = async item => {
    try {
      await updateFeedbackItem(item.id, { status: item.status === 'resolved' ? 'open' : 'resolved' });
      await refresh();
    } catch (error) { setMessage(error.message || '처리 상태를 변경하지 못했습니다.'); }
  };
  const submitNote = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await createMeetingNote({ organization_id: organizationId, title: form.get('title'), body: form.get('body'), meeting_at: new Date().toISOString() });
      event.currentTarget.reset();
      setMessage('회의 노트를 저장했습니다.');
      await refresh();
    } catch (error) { setMessage(error.message || '회의 노트를 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const openCount = items.filter(item => item.status !== 'resolved').length;

  return <>
    <div className="page-title"><div><p>내부 고객 이슈 관리</p><h1>컴플레인</h1><span>매장에서 접수한 컴플레인과 개선 제안을 등록하고 후속 조치를 관리합니다.</span></div></div>
    <section className="schedule-layout"><section className="card full-card"><div className="card-title"><div><h2>컴플레인 등록</h2><p>접수 내용과 고객 정보를 남겨 후속 조치를 관리하세요.</p></div></div><form className="settings-form" onSubmit={submitComplaint}><div className="settings-input-grid"><label>구분<select name="kind" defaultValue="complaint"><option value="complaint">컴플레인</option><option value="suggestion">개선 제안</option></select></label><label>작성자 또는 고객명<input name="author" placeholder="선택 입력"/></label></div><label>내용<textarea name="content" required placeholder="언제, 어떤 이슈가 발생했는지 입력해 주세요."/></label><button className="submit" disabled={busy}>{busy ? '등록 중…' : '컴플레인 등록'}</button></form></section>
      <section className="card full-card"><div className="card-title"><div><h2>처리 목록</h2><p>내부에서 등록한 컴플레인과 개선 제안만 표시합니다.</p></div><span className="chip orange">미처리 {openCount}건</span></div>{loading ? <div className="loading-bar" role="status"><i/><span>컴플레인을 불러오는 중…</span></div> : items.length ? items.map(item => <div className="salary-row" key={item.id}><span className="grow"><b>{item.kind === 'complaint' ? '컴플레인' : '개선 제안'}</b><small>{item.author_name || '익명'} · {koreanDateTime(item.occurred_at)}<br/>{item.content}</small></span><span className={`chip ${item.status === 'resolved' ? 'green' : 'orange'}`}>{item.status === 'resolved' ? '처리 완료' : '확인 필요'}</span><button type="button" className="outline" onClick={() => resolve(item)}>{item.status === 'resolved' ? '다시 열기' : '처리 완료'}</button></div>) : <div className="empty-schedule"><b>등록된 컴플레인이 없습니다.</b><span>새로운 고객 이슈가 접수되면 이곳에서 관리할 수 있습니다.</span></div>}</section></section>
    <section className="card full-card"><div className="card-title"><div><h2>회의 노트</h2><p>컴플레인 대응 결정 사항과 담당 업무를 공유합니다.</p></div></div><form className="settings-form" onSubmit={submitNote}><div className="settings-input-grid"><label>회의 제목<input name="title" required placeholder="예: 주간 고객 이슈 회의"/></label></div><label>회의 내용<textarea name="body" placeholder="결정 사항과 담당 업무를 기록해 주세요."/></label><button className="outline" disabled={busy}>회의 노트 저장</button></form>{notes.slice(0, 5).map(note => <div className="salary-row" key={note.id}><span className="grow"><b>{note.title}</b><small>{koreanDateTime(note.meeting_at)}<br/>{note.body || '내용 없음'}</small></span></div>)}</section>
    {message && <p className="review-collector-message" role="status">{message}</p>}
  </>;
}
