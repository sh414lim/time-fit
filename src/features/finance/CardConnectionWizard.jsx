import React, { useEffect, useState } from 'react';
import { createCardConnection, disconnectCardConnection, discoverCardConnectionAssets, executeCardSync, getAuthContext, loadCardConnectionHistory, loadCardConnections, loadCardSyncRun, reauthenticateCardConnection, selectCardConnectionAssets, syncCardConnection } from '../../lib/supabase';

const CARD_COMPANIES = [
  ['0301', 'KB국민카드'], ['0302', '현대카드'], ['0303', '삼성카드'], ['0304', 'NH농협카드'], ['0305', 'BC카드'], ['0306', '신한카드'], ['0307', '씨티카드'],
  ['0309', '우리카드'], ['0311', '롯데카드'], ['0313', '하나카드'], ['0315', '전북카드'], ['0316', '광주카드'], ['0320', '수협카드'], ['0321', '제주카드'],
];
const emptyAuthentication = () => ({ organization: '0301', loginType: '1', id: '', password: '', derFile: null, keyFile: null });
const statusLabel = status => ({ authenticating: '인증 확인 중', backfilling: '최초 내역 수집 중', active: '자동 연결 정상', degraded: '연결 확인 필요', reauth_required: '재인증 필요', paused: '수집 일시 정지' }[status] || '연결 준비');

const fileToBase64 = async file => {
  if (!file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

async function authenticationPayload(form) {
  const common = { organization: form.organization, loginType: form.loginType, password: form.password };
  if (form.loginType === '1') return { ...common, id: form.id.trim() };
  return { ...common, derFile: await fileToBase64(form.derFile), keyFile: await fileToBase64(form.keyFile) };
}

function authenticationError(form) {
  if (!form.organization || !['0', '1'].includes(form.loginType) || !form.password) return '카드사, 인증 방식과 비밀번호를 확인해 주세요.';
  if (form.loginType === '1' && !form.id.trim()) return '카드사 로그인 ID를 입력해 주세요.';
  if (form.loginType === '0' && (!form.derFile || !form.keyFile)) return '공동인증서 DER 파일과 KEY 파일을 모두 선택해 주세요.';
  return '';
}

function AuthenticationFields({ value, onChange }) {
  const update = patch => onChange(current => ({ ...current, ...patch }));
  return <div className="connection-auth-grid">
    <label>카드사<select value={value.organization} onChange={event => update({ organization: event.target.value })}>{CARD_COMPANIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
    <label>인증 방식<select value={value.loginType} onChange={event => update({ loginType: event.target.value, id: '', derFile: null, keyFile: null })}><option value="1">카드사 ID·비밀번호</option><option value="0">공동인증서</option></select></label>
    {value.loginType === '1' ? <label>카드사 로그인 ID<input autoComplete="username" value={value.id} onChange={event => update({ id: event.target.value })}/></label> : <><label>인증서 파일(.der)<input type="file" accept=".der,application/x-x509-ca-cert" onChange={event => update({ derFile: event.target.files?.[0] || null })}/></label><label>개인키 파일(.key)<input type="file" accept=".key,application/octet-stream" onChange={event => update({ keyFile: event.target.files?.[0] || null })}/></label></>}
    <label>인증 비밀번호<input type="password" autoComplete="new-password" value={value.password} onChange={event => update({ password: event.target.value })}/></label>
  </div>;
}

export default function CardConnectionWizard() {
  const [organizationId, setOrganizationId] = useState('');
  const [isOwner, setIsOwner] = useState(false);
  const [connections, setConnections] = useState([]);
  const [connection, setConnection] = useState(null);
  const [assets, setAssets] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [businessType, setBusinessType] = useState('corporation');
  const [consented, setConsented] = useState(false);
  const [step, setStep] = useState('consent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [authentication, setAuthentication] = useState(emptyAuthentication);
  const [reauthForm, setReauthForm] = useState(emptyAuthentication);
  const provider = import.meta.env.VITE_CARD_CONNECTION_PROVIDER || 'codef';
  const isCodef = provider === 'codef';

  useEffect(() => {
    let active = true;
    getAuthContext().then(async context => {
      if (!active) return;
      const nextOrganizationId = context.membership?.organization_id || '';
      setOrganizationId(nextOrganizationId); setIsOwner(Boolean(context.isOrganizationOwner));
      if (!nextOrganizationId) return;
      const items = await loadCardConnections(nextOrganizationId);
      if (!active) return;
      setConnections(items);
      const current = items.find(item => ['active', 'backfilling', 'degraded', 'reauth_required', 'authenticating'].includes(item.status));
      if (current) {
        setConnection(current); setStep(['active', 'degraded', 'reauth_required'].includes(current.status) ? 'complete' : 'cards');
        loadCardConnectionHistory({ organizationId: nextOrganizationId, connectionId: current.id }).then(value => active && setHistory(value)).catch(() => {});
      }
    }).catch(nextError => active && setError(nextError.message || '카드 연결 상태를 확인하지 못했습니다.'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!result?.queued || !result.runId || !organizationId) return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const run = await loadCardSyncRun({ organizationId, runId: result.runId });
        if (!active) return;
        if (run.status === 'succeeded') {
          setResult({ imported: run.inserted_count || 0, duplicates: run.duplicate_count || 0, groups: 0 });
          setConnection(item => ({ ...item, status: 'active', last_succeeded_at: run.finished_at }));
          window.dispatchEvent(new CustomEvent('timefit-card-sync-complete'));
          return;
        }
        if (run.status === 'failed' || run.status === 'partial') {
          setResult(null); setConnection(item => ({ ...item, status: 'degraded' }));
          setError('카드 내역 수집을 완료하지 못했습니다. 연결 상태를 확인해 주세요.');
          return;
        }
        timer = window.setTimeout(poll, 4000);
      } catch { if (active) timer = window.setTimeout(poll, 8000); }
    };
    timer = window.setTimeout(poll, 2000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [result?.queued, result?.runId, organizationId]);

  const startConnection = async form => {
    const validation = isCodef ? authenticationError(form) : '';
    if (validation) return setError(validation);
    setBusy(true); setError('');
    try {
      const auth = isCodef ? await authenticationPayload(form) : {};
      const created = await createCardConnection({ organizationId, provider, businessType, authentication: auth });
      setAuthentication(emptyAuthentication());
      const discovered = await discoverCardConnectionAssets({ organizationId, connectionId: created.id });
      setConnection(created); setConnections(items => [created, ...items]); setAssets(discovered);
      setSelectedIds(discovered.map(item => item.id)); setStep('cards');
    } catch (nextError) { setError(nextError.message || '카드사 연결을 시작하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const continueFromConsent = () => {
    if (!consented) return setError('필수 수집·이용 동의 내용을 확인해 주세요.');
    setError('');
    if (isCodef) setStep('authenticate'); else startConnection({});
  };

  const loadAssets = async () => {
    if (!connection) return;
    setBusy(true); setError('');
    try { const discovered = await discoverCardConnectionAssets({ organizationId, connectionId: connection.id }); setAssets(discovered); setSelectedIds(discovered.filter(item => item.status === 'selected').map(item => item.id)); }
    catch (nextError) { setError(nextError.message || '보유카드를 조회하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const executeQueuedSync = async response => {
    const queuedRunId = response.runId || response.run?.id;
    if ((response.queued || response.run?.status === 'queued') && queuedRunId) return executeCardSync({ organizationId, runId: queuedRunId });
    return response;
  };

  const connectSelectedCards = async () => {
    if (!selectedIds.length) return setError('자동 수집할 카드를 한 장 이상 선택해 주세요.');
    setBusy(true); setError(''); setStep('syncing');
    try {
      await selectCardConnectionAssets({ organizationId, connectionId: connection.id, assetIds: selectedIds });
      const response = await syncCardConnection({ organizationId, connectionId: connection.id, mode: 'backfill' });
      const executed = await executeQueuedSync(response);
      const stillRunning = executed.run?.status === 'running';
      setResult(stillRunning ? { queued: true, runId: executed.run.id } : executed.result || { imported: executed.run?.inserted_count || 0, duplicates: executed.run?.duplicate_count || 0, groups: 0 });
      setConnection(item => ({ ...item, status: stillRunning ? 'backfilling' : 'active', last_succeeded_at: stillRunning ? item.last_succeeded_at : new Date().toISOString() }));
      setStep('complete'); window.dispatchEvent(new CustomEvent('timefit-card-sync-complete'));
    } catch (nextError) { setError(nextError.message || '최초 카드 내역을 가져오지 못했습니다.'); setStep('cards'); }
    finally { setBusy(false); }
  };

  const retrySync = async () => {
    if (!connection) return;
    setBusy(true); setError('');
    try {
      const response = await syncCardConnection({ organizationId, connectionId: connection.id, mode: 'incremental' });
      const executed = await executeQueuedSync(response);
      const stillRunning = executed.run?.status === 'running';
      setResult(stillRunning ? { queued: true, runId: executed.run.id } : executed.result || { imported: executed.run?.inserted_count || 0, duplicates: executed.run?.duplicate_count || 0, groups: 0 });
      const nextStatus = stillRunning ? 'backfilling' : 'active';
      setConnection(item => ({ ...item, status: nextStatus, last_error_code: null, last_error_category: null, next_sync_at: null }));
      setConnections(items => items.map(item => item.id === connection.id ? { ...item, status: nextStatus, last_error_code: null, last_error_category: null } : item));
      window.dispatchEvent(new CustomEvent('timefit-card-sync-complete'));
    } catch (nextError) { setError(nextError.message || '카드 내역을 다시 가져오지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const submitReauthentication = async () => {
    if (!connection) return;
    const validation = isCodef ? authenticationError(reauthForm) : '';
    if (validation) return setError(validation);
    setBusy(true); setError('');
    try {
      const auth = isCodef ? await authenticationPayload(reauthForm) : reauthForm;
      const updated = await reauthenticateCardConnection({ organizationId, connectionId: connection.id, authentication: auth });
      setConnection(updated); setConnections(items => items.map(item => item.id === updated.id ? updated : item)); setReauthForm(emptyAuthentication());
      setHistory(await loadCardConnectionHistory({ organizationId, connectionId: updated.id })); setStep('complete'); setResult(null);
    } catch (nextError) { setError(nextError.message || '카드사 재인증을 완료하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  const disconnectConnection = async () => {
    if (!connection || !window.confirm('카드 자동 연결을 해제할까요? 기존 지출 내역은 유지되며 이후 카드 내역은 자동 수집되지 않습니다.')) return;
    setBusy(true); setError('');
    try {
      const updated = await disconnectCardConnection({ organizationId, connectionId: connection.id });
      setConnections(items => items.map(item => item.id === updated.id ? updated : item));
      setConnection(null); setAssets([]); setSelectedIds([]); setResult(null); setHistory([]); setConsented(false); setAuthentication(emptyAuthentication()); setStep('consent');
    } catch (nextError) { setError(nextError.message || '카드 연결을 해제하지 못했습니다.'); }
    finally { setBusy(false); }
  };

  if (!isOwner) return <div className="connection-wizard denied"><b>소유자 확인이 필요해요</b><span>카드사 인증과 카드 선택은 사업장 소유자만 진행할 수 있습니다.</span></div>;
  const stepText = step === 'consent' ? '1/4 이용 동의' : step === 'authenticate' ? '2/4 카드사 인증' : step === 'cards' ? '3/4 카드 선택' : step === 'syncing' ? '4/4 최초 수집' : '연결 완료';

  return <div className="connection-wizard">
    <div className="connection-wizard-head"><div><b>{provider === 'mock' ? '카드 연결 테스트' : '실제 카드사 연결'}</b><span>{provider === 'mock' ? '테스트 데이터만 사용하며 실제 카드사에는 연결되지 않습니다.' : isCodef ? 'CODEF를 통해 법인카드 내역을 안전하게 연결합니다.' : '외부 카드 데이터 Provider 연결'}</span></div><em>{stepText}</em></div>
    {connections.length > 0 && <div className="connection-status-list">{connections.slice(0, 2).map(item => <span key={item.id}><i className={item.status}/>{item.provider} · {statusLabel(item.status)}{item.last_succeeded_at ? ` · ${new Date(item.last_succeeded_at).toLocaleString('ko-KR')}` : ''}</span>)}</div>}
    {step === 'consent' && <div className="connection-consent"><label>사업자 유형<select value={businessType} onChange={event => setBusinessType(event.target.value)}><option value="corporation">법인사업자</option><option value="sole_proprietor">개인사업자</option></select></label><label className="connection-check"><input type="checkbox" checked={consented} onChange={event => setConsented(event.target.checked)}/><span><b>카드 사용내역 수집·이용 및 CODEF 제공에 동의합니다. (필수)</b><small>보유카드와 승인·취소·매입 내역을 연결 목적으로 처리합니다. TimeFit은 카드번호 전체와 CVC를 저장하지 않습니다.</small></span></label><button className="submit" disabled={busy || !organizationId || !consented} onClick={continueFromConsent}>카드사 인증 계속</button></div>}
    {step === 'authenticate' && <div className="connection-auth"><div><b>카드사 인증</b><span>CODEF 연결에 필요한 값이며 인증 완료 후 입력란에서 즉시 제거됩니다.</span></div><AuthenticationFields value={authentication} onChange={setAuthentication}/><div className="connection-reauth-actions"><button className="outline" disabled={busy} onClick={() => { setStep('consent'); setError(''); }}>이전</button><button className="submit" disabled={busy} onClick={() => startConnection(authentication)}>{busy ? '카드사 인증 중…' : '인증하고 보유카드 조회'}</button></div></div>}
    {step === 'cards' && <div className="connection-assets"><div className="connection-assets-title"><b>자동 수집할 카드 선택</b><button className="outline" disabled={busy} onClick={loadAssets}>{busy ? '조회 중…' : assets.length ? '다시 조회' : '보유카드 조회'}</button></div>{assets.length ? assets.map(asset => <label key={asset.id} className="connection-asset"><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...new Set([...ids, asset.id])] : ids.filter(id => id !== asset.id))}/><span><b>{asset.display_name}</b><small>•••• {asset.last4} · {asset.status === 'selected' ? '선택됨' : '조회됨'}</small></span></label>) : <p>조회된 카드가 없습니다. 보유카드 조회를 다시 실행해 주세요.</p>}<button className="submit" disabled={busy || !selectedIds.length} onClick={connectSelectedCards}>{busy ? '처리 중…' : `선택한 카드 ${selectedIds.length}장 연결`}</button></div>}
    {step === 'syncing' && <div className="connection-syncing" role="status"><i/><div><b>최근 90일 내역을 불러오고 있어요</b><span>승인·취소·부분취소 내역을 중복 없이 정리합니다.</span></div></div>}
    {step === 'complete' && <div className="connection-complete"><div><b>{result?.queued ? '카드 내역 수집을 접수했어요' : connection?.status === 'reauth_required' ? '카드사 재인증이 필요해요' : connection?.status === 'degraded' ? '자동 수집을 다시 확인해 주세요' : '카드 자동 연결이 완료됐어요'}</b><span>{result?.queued ? '백그라운드에서 처리합니다. 화면을 닫아도 안전하며 완료 후 내역에 반영됩니다.' : connection?.status === 'reauth_required' ? '인증정보 갱신 전까지 자동 재시도하지 않습니다.' : connection?.status === 'degraded' ? `${connection.last_error_category || '일시 오류'} · ${connection.next_sync_at ? `${new Date(connection.next_sync_at).toLocaleString('ko-KR')} 자동 재시도` : '재시도 대기 중'}` : result ? `신규 ${result.imported || 0}건 · 중복 제외 ${result.duplicates || 0}건 · 거래 ${result.groups || 0}개` : '마지막으로 연결된 카드의 자동 수집 상태입니다.'}</span></div><div className="connection-reauth-actions">{connection?.status === 'degraded' ? <button className="outline" disabled={busy} onClick={retrySync}>{busy ? '동기화 중…' : '지금 동기화'}</button> : connection?.status === 'reauth_required' ? <button className="outline" onClick={() => { setStep('reauth'); setError(''); }}>카드사 재인증</button> : <button className="outline" onClick={() => { setStep('cards'); setError(''); loadAssets(); }}>연결 카드 변경</button>}<button className="outline danger" disabled={busy} onClick={disconnectConnection}>{busy ? '해제 중…' : '카드 연결 해제'}</button></div></div>}
    {step === 'reauth' && <div className="connection-reauth"><div><b>카드사 재인증</b><span>새 인증이 성공한 경우에만 기존 연결정보를 교체합니다.</span></div><AuthenticationFields value={reauthForm} onChange={setReauthForm}/><div className="connection-reauth-actions"><button className="outline" disabled={busy} onClick={() => { setStep('complete'); setReauthForm(emptyAuthentication()); }}>변경 취소</button><button className="submit" disabled={busy} onClick={submitReauthentication}>{busy ? '인증 확인 중…' : '카드사 재인증'}</button></div></div>}
    {history.length > 0 && <div className="connection-history"><b>연결 변경 이력</b>{history.slice(0, 5).map(item => <span key={item.id}><i/>{item.action === 'credentials_refreshed' ? '인증정보 갱신' : item.action} · {new Date(item.created_at).toLocaleString('ko-KR')}</span>)}</div>}
    {error && <div className="connection-error" role="alert"><span>{error}</span><button onClick={() => setError('')}>닫기</button></div>}
  </div>;
}
