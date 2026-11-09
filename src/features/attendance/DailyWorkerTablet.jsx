import React, { useEffect, useRef, useState } from 'react';
import { dailyWorkerAttendance } from '../../lib/supabase';

const onlyDigits = (value, length) => String(value || '').replace(/\D/g, '').slice(0, length);
const maskPhone = value => {
  const raw = onlyDigits(value, 11);
  if (raw.length < 8) return raw;
  return `${raw.slice(0, 3)}-${'*'.repeat(Math.max(3, raw.length - 7))}-${raw.slice(-4)}`;
};
const maskResident = value => {
  const raw = onlyDigits(value, 13);
  return raw.length === 13 ? `${raw.slice(0, 6)}-${raw[6]}******` : '';
};
const createRequestKey = () => {
  if (!globalThis.crypto?.randomUUID) throw new Error('secure_request_id_unavailable');
  return globalThis.crypto.randomUUID();
};
const formatAttendanceTime = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '-';
const formatWorkDate = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T12:00:00+09:00`)) : '-';
const formatWorkedTime = (checkedInAt, checkedOutAt) => {
  if (!checkedInAt || !checkedOutAt) return '근무 중';
  const minutes = Math.max(0, Math.round((new Date(checkedOutAt).getTime() - new Date(checkedInAt).getTime()) / 60000));
  return minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
};

const ERROR_MESSAGES = {
  daily_worker_invalid_phone: '휴대전화 번호를 010부터 정확히 입력해 주세요.',
  daily_worker_invalid_resident: '주민등록번호와 생년월일을 다시 확인해 주세요.',
  daily_worker_invalid_name: '이름은 2자 이상 입력해 주세요.',
  daily_worker_privacy_consent_required: '개인정보 수집·이용 동의가 필요합니다.',
  daily_worker_identity_conflict: '기존 등록 정보와 일치하지 않습니다. 관리자에게 문의해 주세요.',
  daily_worker_already_checked_in: '이미 출근 등록이 완료됐습니다.',
  daily_worker_already_checked_out: '오늘의 퇴근 등록이 이미 완료됐습니다.',
  daily_worker_open_attendance_not_found: '퇴근할 출근 기록을 찾지 못했습니다. 전화번호를 확인해 주세요.',
  daily_worker_additional_verification_required: '같은 전화번호로 여러 근로자가 확인됩니다. 관리자에게 문의해 주세요.',
  tablet_device_not_active: '태블릿 연결이 만료됐습니다. 관리자 연결이 필요합니다.',
  tablet_access_denied: '이 사업장의 태블릿 출퇴근 기능이 비활성화되어 있습니다.',
  daily_worker_secure_storage_unavailable: '보안 저장 설정을 확인하는 중입니다. 관리자에게 문의해 주세요.',
  daily_worker_attendance_timeout: '서버 응답이 지연되고 있습니다. 잠시 후 같은 화면에서 다시 시도해 주세요.',
  daily_worker_failed: '기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  secure_request_id_unavailable: '안전한 요청을 만들 수 없습니다. 브라우저를 새로고침해 주세요.',
};

export default function DailyWorkerTablet({ deviceToken, onMessage }) {
  const [mode, setMode] = useState('check_in');
  const [name, setName] = useState('');
  const [resident, setResident] = useState('');
  const [phone, setPhone] = useState('');
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [resultSummary, setResultSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const idleTimer = useRef(null);

  const reset = (nextMode = mode) => {
    setName('');
    setResident('');
    setPhone('');
    setPrivacyConsent(false);
    setConfirmation(null);
    setMode(nextMode);
  };

  useEffect(() => {
    window.clearTimeout(idleTimer.current);
    if (name || resident || phone || confirmation) idleTimer.current = window.setTimeout(() => reset(mode), 120000);
    return () => window.clearTimeout(idleTimer.current);
  }, [name, resident, phone, confirmation, mode]);

  const prepare = event => {
    event.preventDefault();
    try {
      if (!/^01[016789][0-9]{7,8}$/.test(phone)) throw new Error('daily_worker_invalid_phone');
      if (mode === 'check_in') {
        if (name.trim().replace(/\s+/g, ' ').length < 2) throw new Error('daily_worker_invalid_name');
        if (!/^[0-9]{13}$/.test(resident)) throw new Error('daily_worker_invalid_resident');
        if (!privacyConsent) throw new Error('daily_worker_privacy_consent_required');
      }
      setConfirmation({ requestKey: createRequestKey(), mode, name: name.trim().replace(/\s+/g, ' '), resident, phone });
    } catch (error) {
      onMessage(ERROR_MESSAGES[error.message] || ERROR_MESSAGES.daily_worker_failed, 'error');
    }
  };

  const submit = async () => {
    if (!confirmation || busy) return;
    setBusy(true);
    try {
      const result = await dailyWorkerAttendance({
        action: confirmation.mode,
        deviceToken,
        requestKey: confirmation.requestKey,
        phone: confirmation.phone,
        ...(confirmation.mode === 'check_in' ? {
          name: confirmation.name,
          residentRegistrationNumber: confirmation.resident,
          privacyConsent: true,
        } : {}),
      });
      const isReview = result.action === 'review_required';
      const message = isReview
        ? `${result.employeeName}님의 이전 출근 기록은 관리자의 확인이 필요합니다.`
        : `${result.employeeName}님 ${confirmation.mode === 'check_in' ? '출근' : '퇴근'} 등록이 완료됐습니다.`;
      reset(confirmation.mode);
      setResultSummary({
        employeeName: result.employeeName,
        workDate: result.workDate,
        checkedInAt: result.checkedInAt,
        checkedOutAt: result.checkedOutAt,
        reviewRequired: isReview,
      });
      onMessage(message, isReview ? 'error' : 'success');
    } catch (error) {
      onMessage(ERROR_MESSAGES[error.message] || ERROR_MESSAGES.daily_worker_failed, 'error');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = nextMode => {
    if (busy) return;
    setResultSummary(null);
    reset(nextMode);
  };

  return <section className="daily-worker-flow" aria-label="단기직원 출퇴근">
    <div className="daily-worker-mode" role="tablist" aria-label="단기직원 출퇴근 선택">
      <button type="button" role="tab" aria-selected={mode === 'check_in'} className={mode === 'check_in' ? 'active' : ''} onClick={() => switchMode('check_in')}><b>출근</b><span>처음 또는 다시 근무 시작</span></button>
      <button type="button" role="tab" aria-selected={mode === 'check_out'} className={mode === 'check_out' ? 'active' : ''} onClick={() => switchMode('check_out')}><b>퇴근</b><span>전화번호로 근무 종료</span></button>
    </div>
    <div className="tablet-intro"><b>{mode === 'check_in' ? '근로자 정보를 입력해 주세요' : '출근할 때 입력한 전화번호를 확인해 주세요'}</b><span>{mode === 'check_in' ? '등록 정보는 해당 사업장의 출퇴근 확인에만 사용됩니다.' : '전화번호 전체를 입력하면 열린 출근 기록에 퇴근이 연결됩니다.'}</span></div>
    <form className="tablet-form daily-worker-form" onSubmit={prepare} autoComplete="off">
      {mode === 'check_in' && <>
        <label className="tablet-field"><span>이름</span><input value={name} maxLength="30" onChange={event => { setName(event.target.value); setConfirmation(null); }} placeholder="이름을 입력해 주세요" required autoFocus/><small>신분증에 표시된 이름</small></label>
        <label className="tablet-field"><span>주민등록번호</span><input type="password" inputMode="numeric" pattern="[0-9]*" maxLength="13" value={resident} onChange={event => { setResident(onlyDigits(event.target.value, 13)); setConfirmation(null); }} placeholder="숫자 13자리" required/><small>화면에는 남지 않으며 서버에서 즉시 암호화됩니다.</small></label>
      </>}
      <label className="tablet-field"><span>휴대전화 번호</span><input inputMode="numeric" pattern="[0-9]*" maxLength="11" value={phone} onChange={event => { setPhone(onlyDigits(event.target.value, 11)); setConfirmation(null); }} placeholder="01012345678" required autoFocus={mode === 'check_out'}/><small>하이픈 없이 숫자만 입력해 주세요.</small></label>
      {mode === 'check_in' && <label className="daily-worker-consent"><input type="checkbox" checked={privacyConsent} onChange={event => { setPrivacyConsent(event.target.checked); setConfirmation(null); }}/><span><b>개인정보 수집·이용에 동의합니다.</b><small>출퇴근 식별과 근로 기록 관리를 위해 이름, 주민등록번호, 전화번호를 수집합니다.</small></span></label>}
      <button className="submit tablet-submit" disabled={busy || Boolean(confirmation)}>{mode === 'check_in' ? '출근 정보 확인' : '퇴근 정보 확인'}</button>
    </form>
    {confirmation && <div className="tablet-confirm daily-worker-confirm"><span className="confirm-mark">✓</span><b>{confirmation.mode === 'check_in' ? `${confirmation.name}님, 출근할까요?` : '입력한 번호로 퇴근할까요?'}</b><dl>{confirmation.mode === 'check_in' && <><div><dt>주민번호</dt><dd>{maskResident(confirmation.resident)}</dd></div><div><dt>이름</dt><dd>{confirmation.name}</dd></div></>}<div><dt>전화번호</dt><dd>{maskPhone(confirmation.phone)}</dd></div></dl><p>확정 후에는 관리자에게 수정을 요청해야 합니다.</p><div><button type="button" className="outline" disabled={busy} onClick={() => setConfirmation(null)}>수정</button><button type="button" className="cta" disabled={busy} onClick={submit}>{busy ? '저장 중…' : confirmation.mode === 'check_in' ? '출근 등록' : '퇴근 등록'}</button></div></div>}
    {resultSummary && <section className={`daily-worker-result ${resultSummary.reviewRequired ? 'review' : ''}`} aria-live="polite"><div><span>✓</span><b>{resultSummary.employeeName}님 근무 기록</b></div><dl><div><dt>날짜</dt><dd>{formatWorkDate(resultSummary.workDate)}</dd></div><div><dt>출근</dt><dd>{formatAttendanceTime(resultSummary.checkedInAt)}</dd></div><div><dt>퇴근</dt><dd>{formatAttendanceTime(resultSummary.checkedOutAt)}</dd></div><div><dt>근무시간</dt><dd>{resultSummary.reviewRequired ? '관리자 확인 필요' : formatWorkedTime(resultSummary.checkedInAt, resultSummary.checkedOutAt)}</dd></div></dl><button type="button" className="outline" onClick={() => setResultSummary(null)}>확인</button></section>}
    <p className="daily-worker-privacy-note">입력 정보는 2분 동안 조작이 없으면 자동으로 초기화됩니다.</p>
  </section>;
}
