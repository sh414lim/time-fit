import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const today = '2026년 8월 9일 (일)';
const defaultEmployees = [
  { id: 1, name: '김민지', team: '운영팀', role: '매니저', pay: '월급제', state: '근무 중', time: '09:02', hours: '7시간 28분', color: 'purple' },
  { id: 2, name: '이준호', team: '매장팀', role: '바리스타', pay: '시급제', state: '근무 중', time: '09:00', hours: '7시간 30분', color: 'blue' },
  { id: 3, name: '박서연', team: '매장팀', role: '바리스타', pay: '시급제', state: '지각', time: '09:18', hours: '7시간 12분', color: 'orange' },
  { id: 4, name: '최도윤', team: '주방팀', role: '조리사', pay: '시급제', state: '미출근', time: '-', hours: '-', color: 'mint' },
  { id: 5, name: '한유진', team: '운영팀', role: '사원', pay: '월급제', state: '휴가', time: '-', hours: '연차 1일', color: 'pink' },
];

const nav = [
  ['dashboard', '홈', '⌂'], ['attendance', '출퇴근', '◷'], ['schedule', '스케줄', '▦'],
  ['leave', '휴가 · 연차', '◫'], ['payroll', '급여 관리', '₩'], ['employees', '직원 관리', '♙'],
];

function Avatar({ name, color = 'blue' }) { return <span className={`avatar ${color}`}>{name[0]}</span>; }
function Chip({ children, type }) { return <span className={`chip ${type}`}>{children}</span>; }
function Modal({ title, children, onClose }) { return <div className="modal-backdrop" onClick={onClose}><section className="modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div>; }

function Dashboard({ employees, setModal, checkedIn }) {
  const working = employees.filter(x => x.state === '근무 중').length + (checkedIn ? 1 : 0);
  return <>
    <div className="hero"><div><p className="date-label">{today}</p><h1>오늘, 매장은 잘 돌아가고 있나요?</h1><p>출퇴근부터 승인 요청까지 필요한 정보를 한 번에 확인하세요.</p></div><button className="cta" onClick={() => setModal('employee')}>직원 등록하기 <span>→</span></button></div>
    <section className="summary-grid">
      <article><p>오늘 출근</p><strong>{18 + (checkedIn ? 1 : 0)}<small>명</small></strong><span>전체 23명 중</span></article>
      <article><p>현재 근무 중</p><strong>{working + 12}<small>명</small></strong><span className="up">어제보다 2명 많아요</span></article>
      <article><p>확인 필요</p><strong className="warn">3<small>건</small></strong><span>지각 1 · 미출근 2</span></article>
      <article><p>이번 달 인건비</p><strong>₩24.8<small>M</small></strong><span>예상 급여 기준</span></article>
    </section>
    <div className="dashboard-layout">
      <section className="card live-card"><div className="card-title"><div><h2>실시간 출퇴근</h2><p>오늘 근무 예정 직원</p></div><button onClick={() => setModal('attendance')}>전체 보기</button></div>
        <div className="attendance-list">{employees.slice(0, 4).map(item => <div className="attendance-row" key={item.id}><Avatar name={item.name} color={item.color}/><div className="grow"><b>{item.name}</b><span>{item.role} · {item.pay}</span></div><div className="time"><Chip type={item.state === '근무 중' ? 'green' : item.state === '지각' ? 'orange' : 'gray'}>{item.state}</Chip><b>{item.time}</b></div></div>)}</div>
      </section>
      <section className="card approval-card"><div className="card-title"><div><h2>승인할 일이 있어요</h2><p>빠르게 확인해 주세요.</p></div><span className="count">3</span></div>
        <button className="approval" onClick={() => setModal('leave')}><Avatar name="이준호" color="purple"/><span><b>이준호님의 연차 신청</b><small>8월 14일 · 연차 1일</small></span><i>›</i></button>
        <button className="approval" onClick={() => setModal('leave')}><Avatar name="박서연" color="orange"/><span><b>박서연님의 출퇴근 수정</b><small>8월 8일 · 출근 시간</small></span><i>›</i></button>
        <button className="approval" onClick={() => setModal('leave')}><Avatar name="최도윤" color="mint"/><span><b>최도윤님의 휴무 신청</b><small>8월 16일 · 주말 휴무</small></span><i>›</i></button>
      </section>
    </div>
    <section className="card weekly"><div className="card-title"><div><h2>이번 주 스케줄</h2><p>8월 9일 ~ 8월 15일</p></div><button onClick={() => setModal('schedule')}>스케줄 관리</button></div><div className="week">{['일\n9','월\n10','화\n11','수\n12','목\n13','금\n14','토\n15'].map((day, i) => <div className={i === 0 ? 'selected-day' : ''} key={day}><b>{day.split('\n')[0]} <small>{day.split('\n')[1]}</small></b><span>{i === 0 ? '18명 근무' : i === 5 ? '휴가 3건' : `${18 + (i % 4)}명 근무`}</span></div>)}</div></section>
  </>;
}

function Attendance({ employees, checkedIn, setCheckedIn }) { const [filter, setFilter] = useState('전체'); return <><div className="page-title"><div><p>{today}</p><h1>출퇴근 관리</h1></div><button className={checkedIn ? 'checkin complete' : 'checkin'} onClick={() => setCheckedIn(!checkedIn)}>{checkedIn ? '✓ 출근 완료 · 퇴근하기' : '◷ 내 출근 기록하기'}</button></div><section className="card full-card"><div className="tabs">{['전체','근무 중','지각','미출근','휴가'].map(t => <button className={filter === t ? 'selected' : ''} onClick={() => setFilter(t)} key={t}>{t}</button>)}</div><div className="employee-table"><div className="table-head"><span>직원</span><span>상태</span><span>출근</span><span>근무 시간</span><span>관리</span></div>{employees.filter(e => filter === '전체' || e.state === filter).map(e => <div className="table-row" key={e.id}><span className="name-cell"><Avatar name={e.name} color={e.color}/><b>{e.name}<small>{e.team} · {e.role}</small></b></span><span><Chip type={e.state === '근무 중' ? 'green' : e.state === '지각' ? 'orange' : 'gray'}>{e.state}</Chip></span><span>{e.time}</span><span>{e.hours}</span><button className="outline">상세</button></div>)}</div></section></> }

function Schedule({ setModal }) { const shifts = [['김민지','09:00 – 18:00','purple'],['이준호','09:00 – 17:00','blue'],['박서연','10:00 – 19:00','orange'],['최도윤','휴무','mint']]; return <><div className="page-title"><div><p>2026년 8월 둘째 주</p><h1>스케줄</h1></div><button className="cta" onClick={() => setModal('schedule')}>+ 근무 추가</button></div><section className="card schedule-card"><div className="schedule-tools"><button>‹</button><b>8월 9일 일요일</b><button>›</button><span/><button className="outline">주간 보기</button></div><div className="shift-list">{shifts.map(([name,time,color]) => <div className="shift" key={name}><Avatar name={name} color={color}/><b>{name}</b><span>{time}</span><button className="ghost">수정</button></div>)}</div></section></> }

function Leave({ setModal }) { return <><div className="page-title"><div><p>2026년 기준</p><h1>휴가 · 연차 관리</h1></div><button className="cta" onClick={() => setModal('leave')}>+ 휴가 신청</button></div><section className="leave-overview"><div className="balance card"><p>내 연차 잔여</p><strong>8.5<small>일</small></strong><div><span>발생 15일</span><span>사용 6.5일</span></div><div className="progress"><i/></div></div><div className="card leave-info"><h2>승인 대기 중인 휴가</h2><p>총 2건의 요청을 확인해 주세요.</p><button onClick={() => setModal('leave')}>요청 확인하기 →</button></div></section><section className="card full-card"><div className="card-title"><div><h2>휴가 사용 내역</h2><p>최근 3개월</p></div></div>{[['8월 14일','연차','이준호','승인 대기'],['7월 28일','오후 반차','김민지','승인 완료'],['7월 18일','연차','한유진','승인 완료']].map(r => <div className="leave-row" key={r.join()}><span><b>{r[0]}</b><small>{r[2]}</small></span><span>{r[1]}</span><Chip type={r[3] === '승인 완료' ? 'green' : 'orange'}>{r[3]}</Chip></div>)}</section></> }

function Payroll() { return <><div className="page-title"><div><p>2026년 8월 급여</p><h1>급여 관리</h1></div><button className="cta">급여 마감하기</button></div><section className="pay-cards"><div className="card"><p>예상 총 인건비</p><strong>₩24,800,000</strong><span>전월 대비 <b>4.2% 증가</b></span></div><div className="card"><p>급여 산정 완료</p><strong>20 <small>/ 23명</small></strong><span>3명은 근태 확인이 필요해요.</span></div></section><section className="card full-card"><div className="card-title"><div><h2>직원별 급여 현황</h2><p>근태 데이터를 기준으로 계산된 예상액입니다.</p></div><button className="outline">CSV 다운로드</button></div>{[['김민지','월급제','₩3,200,000','완료'],['이준호','시급제','₩2,148,500','완료'],['박서연','시급제','산정 전','근태 확인 필요']].map(r => <div className="salary-row" key={r[0]}><Avatar name={r[0]}/><b>{r[0]}</b><span>{r[1]}</span><strong>{r[2]}</strong><Chip type={r[3] === '완료' ? 'green' : 'orange'}>{r[3]}</Chip></div>)}</section></> }

function Employees({ employees, setModal }) { return <><div className="page-title"><div><p>재직 23명</p><h1>직원 관리</h1></div><button className="cta" onClick={() => setModal('employee')}>+ 직원 등록</button></div><section className="card full-card"><div className="search">⌕ <input placeholder="이름, 부서, 직책으로 검색" /></div>{employees.map(e => <div className="employee-row" key={e.id}><Avatar name={e.name} color={e.color}/><span className="grow"><b>{e.name}</b><small>{e.team} · {e.role}</small></span><span>{e.pay}</span><Chip type="green">재직</Chip><button className="outline">관리</button></div>)}</section></> }

function App() {
  const [active, setActive] = useState('dashboard'); const [employees, setEmployees] = useState(defaultEmployees); const [modal, setModal] = useState(null); const [checkedIn, setCheckedIn] = useState(false); const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2200); return () => clearTimeout(timer); }, [toast]);
  const content = { dashboard: <Dashboard employees={employees} setModal={setModal} checkedIn={checkedIn}/>, attendance: <Attendance employees={employees} checkedIn={checkedIn} setCheckedIn={setCheckedIn}/>, schedule: <Schedule setModal={setModal}/>, leave: <Leave setModal={setModal}/>, payroll: <Payroll/>, employees: <Employees employees={employees} setModal={setModal}/> }[active];
  const saveEmployee = e => { e.preventDefault(); const data = new FormData(e.currentTarget); const name = data.get('name'); if (!name) return; setEmployees([...employees, { id: Date.now(), name, team: data.get('team') || '미정', role: data.get('role') || '직원', pay: data.get('pay'), state: '미출근', time: '-', hours: '-', color: 'blue' }]); setModal(null); setToast(`${name}님을 등록했어요.`); };
  const approve = () => { setModal(null); setToast('요청을 승인했어요.'); };
  return <div className="app"><aside className="sidebar"><div className="brand"><span>✓</span><b>timefit</b></div><nav>{nav.map(([id,label,icon]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}><i>{icon}</i><span>{label}</span></button>)}</nav><div className="store"><small>현재 사업장</small><b>타임핏 성수점</b><span>관리자 계정 · 김대표</span></div></aside><main><header><p>오늘도 매장을 가볍게 운영해 보세요.</p><div><button className="help">도움말</button><span className="profile">김</span></div></header><div className="content">{content}</div></main><nav className="mobile-nav">{nav.slice(0,5).map(([id,label,icon]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}><i>{icon}</i><span>{label.replace(' · 연차','')}</span></button>)}</nav>{toast && <div className="toast">✓ {toast}</div>}
    {modal === 'employee' && <Modal title="직원 등록" onClose={() => setModal(null)}><form onSubmit={saveEmployee}><label>이름<input name="name" placeholder="직원 이름" autoFocus required/></label><div className="form-row"><label>부서<input name="team" placeholder="예: 매장팀"/></label><label>직책<input name="role" placeholder="예: 바리스타"/></label></div><label>급여 형태<select name="pay" defaultValue="시급제"><option>시급제</option><option>월급제</option><option>일급제</option></select></label><button className="submit">등록 완료</button></form></Modal>}
    {modal === 'leave' && <Modal title="휴가 요청 검토" onClose={() => setModal(null)}><div className="request-detail"><Avatar name="이준호" color="purple"/><div><b>이준호님의 연차 신청</b><p>8월 14일 금요일 · 연차 1일</p></div></div><label className="note">관리자 메모<textarea placeholder="승인 메모를 남길 수 있어요."/></label><div className="modal-actions"><button className="reject" onClick={() => {setModal(null);setToast('요청을 반려했어요.')}}>반려</button><button className="submit" onClick={approve}>승인하기</button></div></Modal>}
    {modal === 'schedule' && <Modal title="근무 일정 추가" onClose={() => setModal(null)}><form onSubmit={e => {e.preventDefault();setModal(null);setToast('근무 일정을 추가했어요.')}}><label>직원<select defaultValue="김민지"><option>김민지</option><option>이준호</option><option>박서연</option></select></label><div className="form-row"><label>시작 시간<input type="time" defaultValue="09:00"/></label><label>종료 시간<input type="time" defaultValue="18:00"/></label></div><button className="submit">일정 저장</button></form></Modal>}
    {modal === 'attendance' && <Modal title="오늘 출퇴근 현황" onClose={() => setModal(null)}><p className="modal-text">총 23명 중 18명이 출근했습니다. 미출근 직원 2명과 지각 직원 1명을 확인해 주세요.</p><button className="submit" onClick={() => {setModal(null);setActive('attendance')}}>출퇴근 관리로 이동</button></Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
