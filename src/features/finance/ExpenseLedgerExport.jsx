import React, { useState } from 'react';
import { loadExpenseLedger } from '../../lib/supabase';
import { downloadExpenseLedgerCsv } from './expenseExport';

const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
const rangeFor = month => { const [year, number] = month.split('-').map(Number); return { from: `${month}-01`, to: `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, '0')}` }; };

export default function ExpenseLedgerExport({ organizationId }) {
  const [month, setMonth] = useState(currentMonth); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const download = async () => { setBusy(true); setMessage(''); try { const result = await loadExpenseLedger(organizationId, rangeFor(month)); if (!result.items?.length) { setMessage('선택한 월에 내보낼 지출이 없습니다.'); return; } downloadExpenseLedgerCsv(result.items, month); setMessage(`${result.items.length}건의 지출 원장을 내려받았어요.`); } catch (error) { setMessage(error.message || '지출 원장을 내보내지 못했습니다.'); } finally { setBusy(false); } };
  return <section className="card full-card expense-ledger-export"><div><b>세무·검토용 지출 원장</b><span>원장 ID와 증빙 여부를 포함한 CSV를 내려받습니다.</span></div><label>내보낼 월<input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label><button className="outline" disabled={busy} onClick={download}>{busy ? '파일 생성 중…' : 'CSV 다운로드'}</button>{message && <small>{message}</small>}</section>;
}
