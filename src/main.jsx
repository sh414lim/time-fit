import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import './styles.css';
import './modal-fix.css';
import './modes.css';
import './mobile.css';
import './refinement.css';
import './feedback.css';
import './navigation.css';
import './leave-policy.css';
import './finance.css';
import './sheet.css';
import './auth.css';
import './staff-categories.css';
import './management-accounts.css';
import './attendance-management.css';
import './monthly-schedule-editor.css';
import { openSchedulePrintView } from './schedulePdf';
import { openPayrollPrintView } from './payrollPdf';
import { schedulePeople } from './scheduleDomain';
import BankConnectionWorkspace from './features/finance/BankConnectionWorkspace';
import { parseGranterCardFile } from './granterCardImport';
import ExpenseReviewQueue from './features/finance/ExpenseReviewQueue';
import FinanceReportDashboard from './features/finance/FinanceReportDashboard';
import ExpenseExceptionInbox from './features/finance/ExpenseExceptionInbox';
import EmployeeReceiptSubmission from './features/finance/EmployeeReceiptSubmission';
import ExpenseReminderSettings from './features/finance/ExpenseReminderSettings';
import ExpenseLedger from './features/finance/ExpenseLedger';
import ManualExpenseForm from './features/finance/ManualExpenseForm';
import { processReceiptDocument } from './lib/supabase';
import { createCorporateCard, ensureImportedCorporateCard, importCardTransactions } from './lib/supabase';
import { acceptEmployeeInvitation, activateTabletDevice, bootstrapTossPlaceConnection, correctAttendanceRecord, createFeedbackItem, createLeaveRequest, createManagementAccount, createManualStaff, createMeetingNote, deleteFinanceDocument, deleteStaffCategory, deleteWorkSchedule, disconnectCorporateCard, ensureManagerOrganization, getAuthContext, getCachedOrganizationSalesDashboard, getManagerTabletOrganization, getOrganizationSettings, getTabletDeviceContext, getTossPlaceConnection, grantStaffLeave, importFeedbackItems, invalidateFinanceReportCache, inviteEmployeeByCode, isAuthSessionError, loadCardTransactions, loadCorporateCards, loadFeedbackItems, loadFinanceDocuments, loadManagementAccounts, loadMeetingNotes, loadOperationalAlerts, loadOrganizationSalesDashboard, loadPayrollWorkspace, loadSalesLaborSummary, loadStaffCategories, loadStaffSensitiveProfile, loadTabletDevices, loadWorkforce, manageManagementAccount, markOperationalAlertRead, openFinanceDocument, previewTabletLeaveRequest, recordQrAttendance, reviewLeaveRequest, reviewWorkSchedule, revokeTabletDevice, runMonthEndOperations, saveCustomTossPlaceCredentials, saveOrganizationSettings, savePayrollContract, savePayrollDraft, saveStaffCategory, saveStaffOrder, saveStaffSensitiveProfile, saveTossPlaceConnection, saveWorkSchedule, saveWorkSchedulesBulk, sendSettlementEmail, signIn, signOut, signUp, supabase, syncOrganizationSales, tabletAttendance, tabletLeaveRequest, updateCorporateCard, updateFeedbackItem, updateOrganizationCardFeeRate, updateStaffPhone, updateStaffProfile, uploadFinanceDocument, uploadStaffAvatar } from './lib/supabase';

const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const currentKoreanDateKey = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const todayKey = currentKoreanDateKey();
function useCurrentKoreanDateKey() {
  const [dateKey, setDateKey] = useState(currentKoreanDateKey);
  useEffect(() => {
    const refreshDate = () => setDateKey(currentKoreanDateKey());
    refreshDate();
    let timer;
    const scheduleMidnightRefresh = () => {
      const currentKey = currentKoreanDateKey();
      const nextKoreanMidnight = Date.parse(`${currentKey}T00:00:00Z`) + 86_400_000 - 9 * 3_600_000;
      timer = window.setTimeout(() => {
        refreshDate();
        scheduleMidnightRefresh();
      }, Math.max(1_000, nextKoreanMidnight - Date.now() + 1_000));
    };
    scheduleMidnightRefresh();
    document.addEventListener('visibilitychange', refreshDate);
    window.addEventListener('focus', refreshDate);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refreshDate);
      window.removeEventListener('focus', refreshDate);
    };
  }, []);
  return dateKey;
}
const dateFromKey = key => new Date(`${key}T12:00:00`);
const formatDateKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
const formatKoreanDate = key => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(dateFromKey(key));
const weekDaysFor = key => { const anchor = dateFromKey(key); const sunday = new Date(anchor); sunday.setDate(anchor.getDate() - anchor.getDay()); return Array.from({ length: 7 }, (_, index) => { const date = new Date(sunday); date.setDate(sunday.getDate() + index); const id = formatDateKey(date); return { id, weekday: KOREAN_WEEKDAYS[index], day: String(date.getDate()), label: formatKoreanDate(id) }; }); };
const monthDaysFor = monthKey => { const [year, month] = monthKey.split('-').map(Number); const first = new Date(year, month - 1, 1, 12); const start = new Date(first); start.setDate(first.getDate() - first.getDay()); return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { id: formatDateKey(date), date, inMonth: date.getMonth() === month - 1, day: date.getDate(), weekday: KOREAN_WEEKDAYS[date.getDay()] }; }); };
const monthLabelFor = monthKey => new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', timeZone: 'Asia/Seoul' }).format(dateFromKey(`${monthKey}-01`));
const today = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(dateFromKey(todayKey));
const STORAGE_PREFIX = 'timefit-mvp:';
const initialLeaveRequests = [
  { id: 'leave-1', date: '8월 14일', startsAt: '2026-08-14', type: '연차', employee: '이준호', amount: '1일', status: '승인 대기', reason: '' },
  { id: 'leave-2', date: '7월 28일', startsAt: '2026-07-28', type: '오후 반차', employee: '김민지', amount: '0.5일', status: '승인 완료', reason: '' },
  { id: 'leave-3', date: '7월 18일', startsAt: '2026-07-18', type: '연차', employee: '한유진', amount: '1일', status: '승인 완료', reason: '' },
];
const initialScheduleByDate = {
  '2026-08-09': [['김민지', '09:00 – 18:00', '오픈 근무'], ['이준호', '09:00 – 17:00', '오전 근무'], ['박서연', '10:00 – 19:00', '마감 근무'], ['최도윤', '휴무', '주휴일']],
  '2026-08-10': [['김민지', '09:00 – 18:00', '오픈 근무'], ['박서연', '09:00 – 17:00', '오전 근무'], ['한유진', '연차', '연차 휴가']],
  '2026-08-11': [['이준호', '12:00 – 20:00', '오후 근무'], ['최도윤', '10:00 – 19:00', '주방 근무'], ['박서연', '휴무', '휴무']],
  '2026-08-12': [['김민지', '09:00 – 18:00', '오픈 근무'], ['이준호', '휴무', '주휴일']],
  '2026-08-13': [['박서연', '10:00 – 19:00', '마감 근무'], ['최도윤', '10:00 – 19:00', '주방 근무']],
  '2026-08-14': [['김민지', '09:00 – 18:00', '오픈 근무'], ['이준호', '연차', '연차 휴가'], ['한유진', '연차', '연차 휴가']],
  '2026-08-15': [['박서연', '10:00 – 19:00', '마감 근무'], ['최도윤', '휴무', '주휴일']],
};
const defaultEmployees = [
  { id: 1, name: '김민지', team: '운영팀', role: '매니저', pay: '월급제', state: '근무 중', time: '09:02', hours: '7시간 28분', color: 'purple' },
  { id: 2, name: '이준호', team: '매장팀', role: '바리스타', pay: '시급제', state: '근무 중', time: '09:00', hours: '7시간 30분', color: 'blue' },
  { id: 3, name: '박서연', team: '매장팀', role: '바리스타', pay: '시급제', state: '지각', time: '09:18', hours: '7시간 12분', color: 'orange' },
  { id: 4, name: '최도윤', team: '주방팀', role: '조리사', pay: '시급제', state: '미출근', time: '-', hours: '-', color: 'mint' },
  { id: 5, name: '한유진', team: '운영팀', role: '사원', pay: '월급제', state: '휴가', time: '-', hours: '연차 1일', color: 'pink' },
];

const nav = [
  ['dashboard', '홈', '⌂'], ['attendance', '출퇴근', '◷'], ['schedule', '스케줄', '▦'],
  ['leave', '휴가 · 연차', '◫'], ['payroll', '급여 관리', '₩'], ['sales', '매출 분석', '▣'], ['documents', '지출 · 증빙', '▤'], ['feedback', '리뷰 · 컴플레인', '☏'], ['employees', '직원 관리', '♙'], ['settings', '운영 설정', '⚙'],
];
const managerMenuGroups = [
  { id: 'operations', label: '매장 운영', items: ['dashboard', 'attendance', 'schedule', 'leave', 'employees'] },
  { id: 'finance', label: '급여 · 매출', items: ['payroll', 'sales'] },
  { id: 'expenses', label: '지출 · 증빙', items: ['documents'] },
  { id: 'feedback', label: '리뷰 · 컴플레인', items: ['feedback'] },
  { id: 'settings', label: '운영 설정', items: ['settings'] },
];

const employeeNav = [
  ['employeeHome', '내 홈', '⌂'], ['mySchedule', '내 스케줄', '▦'], ['myAttendance', '출퇴근', '◷'], ['myLeave', '휴가', '◫'], ['myReceipts', '영수증', '▤'],
];
const DEFAULT_SHIFT_TYPES = ['일반 근무', '오픈 근무', '마감 근무', '오전 근무', '오후 근무', '휴무'];
const DEFAULT_SHIFT_COLORS = { '일반 근무':'#16A34A', '오픈 근무':'#2563EB', '마감 근무':'#7C3AED', '오전 근무':'#0EA5E9', '오후 근무':'#F97316', '풀타임 근무':'#0F9F8F', '휴무':'#64748B', '연차':'#8B5CF6' };
const shiftColorFor = (name, colors = {}) => {
  const label = String(name || '').trim();
  return colors[label] || colors[`${label} 근무`] || (label.endsWith('근무') ? colors[label.replace(/\s*근무$/, '')] : null) || DEFAULT_SHIFT_COLORS[label] || DEFAULT_SHIFT_COLORS[`${label} 근무`] || '#64748B';
};
function useShiftColors(organizationId) {
  const [colors, setColors] = useState(DEFAULT_SHIFT_COLORS);
  useEffect(() => { if (organizationId && supabase) getOrganizationSettings(organizationId).then(settings => setColors({ ...DEFAULT_SHIFT_COLORS, ...(settings?.shift_type_colors || {}) })).catch(() => {}); const sync = event => setColors({ ...DEFAULT_SHIFT_COLORS, ...(event.detail?.shift_type_colors || {}) }); window.addEventListener('timefit:settings-saved', sync); return () => window.removeEventListener('timefit:settings-saved', sync); }, [organizationId]);
  return colors;
}
const DEFAULT_LEAVE_POLICY = { annual_leave_grant_days: 15, annual_leave_grant_after_months: 12, monthly_leave_enabled: true, monthly_leave_grant_days: 1, monthly_leave_min_scheduled_days: 1, weekly_holiday_weekdays: [0], public_holiday_dates: [], exclude_holidays_from_leave: true, public_holiday_work_compensation: 'none', public_holiday_work_compensation_days: 1, weekly_holiday_work_compensation: 'none', weekly_holiday_work_compensation_days: 1, attendance_rounding_minutes: 30, attendance_rounding_mode: 'ceil', payroll_deduct_break_enabled: true, payroll_rounding_enabled: true, month_end_auto_processing_enabled: true };
const completedMonthsBetween = (joinedOn, asOf = todayKey) => { if (!joinedOn) return 0; const joined = dateFromKey(joinedOn); const current = dateFromKey(asOf); return Math.max(0, (current.getFullYear() - joined.getFullYear()) * 12 + current.getMonth() - joined.getMonth() - (current.getDate() < joined.getDate() ? 1 : 0)); };
const monthKeyFor = date => date.slice(0, 7);
const leaveEntitlementFor = (employee, scheduleRows, settings = DEFAULT_LEAVE_POLICY, leaveGrants = []) => {
  const policy = { ...DEFAULT_LEAVE_POLICY, ...settings }; const completedMonths = completedMonthsBetween(employee.joinedOn);
  const annualEligible = completedMonths >= Number(policy.annual_leave_grant_after_months || 12);
  const scheduledDaysByMonth = scheduleRows.filter(row => row.staff_id === employee.id && !row.is_day_off && row.starts_at && row.work_date <= todayKey).reduce((result, row) => ({ ...result, [monthKeyFor(row.work_date)]: (result[monthKeyFor(row.work_date)] || 0) + 1 }), {});
  const monthlyEligibleMonths = annualEligible || !policy.monthly_leave_enabled ? 0 : Array.from({ length: completedMonths }, (_, index) => index).filter(index => {
    const joined = dateFromKey(employee.joinedOn); const month = new Date(joined.getFullYear(), joined.getMonth() + index, 1, 12); const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    return (scheduledDaysByMonth[key] || 0) >= Number(policy.monthly_leave_min_scheduled_days || 0);
  }).length;
  const annualGranted = annualEligible ? Number(policy.annual_leave_grant_days || 0) : 0;
  const monthlyGranted = monthlyEligibleMonths * Number(policy.monthly_leave_grant_days || 0);
  const employeeGrants = leaveGrants.filter(grant => grant.staff_id === employee.id);
  const automaticGrantRows = employeeGrants.filter(grant => ['monthly_leave', 'annual_leave'].includes(grant.grant_type));
  const automaticMonthlyGranted = automaticGrantRows.filter(grant => grant.grant_type === 'monthly_leave').reduce((sum, grant) => sum + Number(grant.amount || 0), 0);
  const automaticAnnualGranted = automaticGrantRows.filter(grant => grant.grant_type === 'annual_leave').reduce((sum, grant) => sum + Number(grant.amount || 0), 0);
  const manualGranted = employeeGrants.filter(grant => !['holiday_substitute_day_off', 'monthly_leave', 'annual_leave'].includes(grant.grant_type)).reduce((sum, grant) => sum + Number(grant.amount || 0), 0);
  const substituteDayOffGranted = employeeGrants.filter(grant => grant.grant_type === 'holiday_substitute_day_off').reduce((sum, grant) => sum + Number(grant.amount || 0), 0);
  const usePersistedAutomaticGrants = automaticGrantRows.length > 0;
  return { annualGranted: usePersistedAutomaticGrants ? automaticAnnualGranted : annualGranted, monthlyGranted: usePersistedAutomaticGrants ? automaticMonthlyGranted : monthlyGranted, manualGranted, substituteDayOffGranted, total: (usePersistedAutomaticGrants ? automaticAnnualGranted + automaticMonthlyGranted : annualGranted + monthlyGranted) + manualGranted, completedMonths };
};

let employeeAvatarRegistry = {};
function Avatar({ name, color = 'blue', imageUrl, team }) { const employee = employeeAvatarRegistry[name] || {}; const resolvedImage = imageUrl || employee.avatarUrl; const resolvedTeam = team || employee.team || '미분류'; return <span className={`avatar ${color} ${resolvedImage ? 'has-image' : 'category-avatar'}`} title={resolvedImage ? `${name} 프로필 사진` : `${resolvedTeam} 구분`} aria-label={resolvedImage ? `${name} 프로필 사진` : `${resolvedTeam} 구분`}>{resolvedImage ? <img src={resolvedImage} alt={`${name} 프로필`} /> : <i>{resolvedTeam}</i>}</span>; }
const categoryCountsForSchedules = (entries = [], employees = []) => { const totals = new Map(); entries.forEach(([name, time, , , staffId, categoryName, categoryColor]) => { if (time === '휴무' || time === '연차') return; const employee = employees.find(item => staffId ? item.id === staffId : item.name === name); const category = categoryName || employee?.team || '미분류'; const color = categoryColor || employee?.categoryColor || '#8B95A1'; const item = totals.get(category) || { name: category, color, count: 0 }; item.count += 1; totals.set(category, item); }); return [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)); };
function Chip({ children, type }) { return <span className={`chip ${type}`}>{children}</span>; }
const formatMoney = value => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value || 0)));
const parseMoney = value => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};
const formatMoneyInput = value => {
  const amount = parseMoney(value);
  return amount ? new Intl.NumberFormat('ko-KR').format(amount) : '';
};
function MoneyInput({ defaultValue = '', onChange, ...props }) {
  const [value, setValue] = useState(() => formatMoneyInput(defaultValue));
  return <input {...props} type="text" inputMode="numeric" value={value} onChange={event => {
    const formatted = formatMoneyInput(event.target.value);
    setValue(formatted);
    onChange?.(event);
  }}/>;
}
const MONEY_INPUT_NAMES = new Set(['hourlyWage', 'dailyWage', 'monthlySalary', 'annualSalary', 'rate']);
const formatMoneyField = field => {
  if (!field || !MONEY_INPUT_NAMES.has(field.name)) return;
  field.type = 'text';
  field.inputMode = 'numeric';
  field.value = formatMoneyInput(field.value);
};
const formatPhone = value => { if (!value) return '미등록'; const digits = String(value).replace(/\D/g, '').replace(/^82/, '0'); return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : value; };
const formatHours = minutes => { const value = Math.max(0, Math.round(minutes || 0)); return value < 60 ? `${value}분` : `${Math.floor(value / 60)}시간${value % 60 ? ` ${value % 60}분` : ''}`; };
const formatAttendanceTime = value => value ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(value)) : '-';
const attendanceMinutes = record => {
  if (!record?.checked_in_at || !record?.checked_out_at) return 0;
  return Math.max(0, (new Date(record.checked_out_at).getTime() - new Date(record.checked_in_at).getTime()) / 60000);
};
const roundedAttendanceMinutes = (record, policy = DEFAULT_LEAVE_POLICY) => {
  const minutes = attendanceMinutes(record); const unit = Number(policy.attendance_rounding_minutes || 30);
  if (!minutes || !unit) return minutes;
  if (policy.attendance_rounding_mode === 'floor') return Math.floor(minutes / unit) * unit;
  if (policy.attendance_rounding_mode === 'nearest') return Math.round(minutes / unit) * unit;
  return Math.ceil(minutes / unit) * unit;
};
const clockMinutes = value => { const [hour, minute] = String(value || '0:0').split(':').map(Number); return hour * 60 + minute; };
const attendanceMinuteOnWorkDate = (timestamp, workDate) => {
  if (!timestamp || !workDate) return 0;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const actualDate = `${parts.year}-${parts.month}-${parts.day}`;
  const dayOffset = Math.round((Date.parse(`${actualDate}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / 86400000);
  return dayOffset * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
};
const payableAttendanceMinutes = (record, schedules = [], policy = DEFAULT_LEAVE_POLICY) => {
  if (!record?.checked_in_at || !record?.checked_out_at) return { grossMinutes: 0, breakMinutes: 0, payableMinutes: 0, scheduledMinutes: 0, overtimeMinutes: 0, schedule: null };
  const schedule = schedules.find(item => item.staff_id === record.staff_id && item.work_date === record.work_date && !item.is_day_off && item.starts_at && item.ends_at) || null;
  let grossMinutes = attendanceMinutes(record);
  let scheduledMinutes = 0; let overtimeMinutes = 0;
  if (schedule) {
    const scheduledStart = clockMinutes(schedule.starts_at); let scheduledEnd = clockMinutes(schedule.ends_at);
    if (scheduledEnd <= scheduledStart) scheduledEnd += 1440;
    const actualStart = attendanceMinuteOnWorkDate(record.checked_in_at, record.work_date);
    const actualEnd = attendanceMinuteOnWorkDate(record.checked_out_at, record.work_date);
    scheduledMinutes = Math.max(0, scheduledEnd - scheduledStart);
    overtimeMinutes = Math.max(0, scheduledStart - actualStart) + Math.max(0, actualEnd - scheduledEnd);
  }
  const breakMinutes = policy.payroll_deduct_break_enabled === false || schedule?.break_paid === true ? 0 : Math.min(grossMinutes, Math.max(0, Number(schedule?.break_minutes ?? policy.standard_break_minutes ?? 0)));
  const netMinutes = Math.max(0, grossMinutes - breakMinutes);
  const payableMinutes = policy.payroll_rounding_enabled === false ? netMinutes : roundedAttendanceMinutes({ checked_in_at: '2026-01-01T00:00:00Z', checked_out_at: new Date(Date.parse('2026-01-01T00:00:00Z') + netMinutes * 60000).toISOString() }, policy);
  return { grossMinutes, breakMinutes, payableMinutes, scheduledMinutes, overtimeMinutes, schedule };
};
const monthlyAttendance = employee => (employee.attendanceHistory || []).filter(record => String(record.work_date || '').startsWith(todayKey.slice(0, 7)));
const completedWorkDays = employee => monthlyAttendance(employee).filter(record => record.checked_in_at && record.checked_out_at).length;
const estimatedPayrollFor = employee => employee.pay === '월급제'
  ? Number(employee.monthlySalary || 0)
  : employee.pay === '연봉제'
    ? Number(employee.annualSalary || 0) / 12
  : employee.pay === '일급제'
    ? Number(employee.dailyWage || 0) * completedWorkDays(employee)
    : Number(employee.hourlyWage || 0) * Number((employee.payrollMinutes ?? employee.monthMinutes) || 0) / 60;
function Modal({ title, children, onClose, variant = '' }) { return <div className="modal-backdrop" onClick={onClose}><section className={`modal ${variant}`} onClick={e => e.stopPropagation()}>{variant && <span className="sheet-handle"/>}<button className="modal-close" onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div>; }
function NoticeModal({ message, tone = 'success', onClose }) {
  const rawMessage = String(message || '');
  const isTransportError = /failed to send a request|edge function|network|failed to fetch|_timeout|timeout/i.test(rawMessage);
  const isError = tone === 'error' || isTransportError || /못|오류|확인|필요|없습니다|입력|실패|저장하지|relation|does not exist|permission|denied|failed|timeout/i.test(rawMessage);
  const displayMessage = isTransportError ? '서버 연결이 지연되고 있어요. 인터넷 연결을 확인한 뒤 잠시 후 다시 시도해 주세요.' : rawMessage;
  return createPortal(<div className="notice-backdrop" role="presentation" onClick={onClose}><section className={`notice-modal ${isError ? 'error' : tone}`} role="alertdialog" aria-live="assertive" aria-label={isError ? '오류 알림' : '처리 알림'} onClick={event => event.stopPropagation()}><span className="notice-icon">{isError ? '!' : '✓'}</span><div><b>{isError ? '처리하지 못했어요' : '처리가 완료됐어요'}</b><p>{displayMessage}</p></div><button type="button" className="notice-close" onClick={onClose}>확인</button></section></div>, document.body);
}
function LoadingBar({ label = '처리 중…' }) { return <div className="loading-bar" role="status" aria-live="polite"><i/><span>{label}</span></div>; }
function usePersistedState(key, fallback) {
  const [value, setValue] = useState(() => { try { const saved = localStorage.getItem(`${STORAGE_PREFIX}${key}`); return saved ? JSON.parse(saved) : fallback; } catch (_) { return fallback; } });
  useEffect(() => { try { localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value)); } catch (_) {} }, [key, value]);
  return [value, setValue];
}

function AuthScreen({ notice = '' }) {
  const [screen, setScreen] = useState('login'); const [accountType, setAccountType] = useState('manager'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setMessage(''); try {
    if (screen === 'signup') {
      const result = await signUp({ email: data.get('email'), password: data.get('password'), displayName: data.get('displayName'), accountType, organizationName: data.get('organizationName') });
      setMessage(result.session ? '가입과 로그인이 완료됐어요. 사업장을 준비하고 있습니다.' : '가입 정보를 확인하는 중입니다.');
    } else { const login = String(data.get('email') || '').trim(); await signIn({ email: login.includes('@') ? login : `${login.toLowerCase()}@accounts.timefit.local`, password: data.get('password') }); }
  } catch (error) { setMessage(error.message || '처리하지 못했습니다. 입력 내용을 확인해 주세요.'); } finally { setBusy(false); } };
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><span>✓</span><b>timefit</b></div><p className="auth-kicker">매장을 위한 쉽고 정확한 근태 관리</p><h1>{screen === 'login' ? '다시 만나 반가워요' : 'TimeFit 시작하기'}</h1><p className="auth-description">{screen === 'login' ? '이메일 또는 최고관리자가 발급한 아이디로 로그인하세요.' : '관리자는 사업장을 만들고, 직원은 고유번호로 초대를 받을 수 있어요.'}</p>{screen === 'signup' && <div className="account-choice"><button type="button" className={accountType === 'manager' ? 'selected' : ''} onClick={() => setAccountType('manager')}><b>관리자</b><span>사업장 생성 · 직원 초대</span></button><button type="button" className={accountType === 'employee' ? 'selected' : ''} onClick={() => setAccountType('employee')}><b>직원</b><span>고유번호 발급 · 초대 수락</span></button></div>}<form onSubmit={submit}>{screen === 'signup' && <label>이름<input name="displayName" required placeholder="이름을 입력해 주세요"/></label>}{screen === 'signup' && accountType === 'manager' && <label>사업장 이름<input name="organizationName" required placeholder="예: 타임핏 성수점"/></label>}<label>{screen === 'login' ? '이메일 또는 관리자 아이디' : '이메일'}<input name="email" type={screen === 'login' ? 'text' : 'email'} required placeholder={screen === 'login' ? 'name@example.com 또는 manager01' : 'name@example.com'} autoComplete="username"/></label><label>비밀번호<input name="password" type="password" minLength="8" required placeholder="8자 이상 입력" autoComplete={screen === 'login' ? 'current-password' : 'new-password'}/></label>{(message || notice) && <p className="auth-message">{message || notice}</p>}<button className="submit" disabled={busy}>{busy ? '처리 중…' : screen === 'login' ? '로그인' : '회원가입'}</button></form><button className="auth-switch" onClick={() => { setScreen(screen === 'login' ? 'signup' : 'login'); setMessage(''); }}>{screen === 'login' ? '처음이신가요? 회원가입' : '이미 계정이 있나요? 로그인'}</button></section></main>;
}

function TabletDeviceApp() {
  const storageKey = 'timefit-tablet-device-token'; const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem(storageKey) || ''); const [context, setContext] = useState(null); const [screen, setScreen] = useState('loading'); const [tab, setTab] = useState('attendance'); const [last4, setLast4] = useState(''); const [last8, setLast8] = useState(''); const [candidate, setCandidate] = useState(null); const [leaveType, setLeaveType] = useState('연차'); const [leaveDate, setLeaveDate] = useState(''); const [leavePreview, setLeavePreview] = useState(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [tone, setTone] = useState('success');
  const show = (text, nextTone = 'success') => { setMessage(text); setTone(nextTone); };
  const clearDevice = () => { localStorage.removeItem(storageKey); setDeviceToken(''); setContext(null); setCandidate(null); setScreen('setup'); };
  useEffect(() => { if (!deviceToken) { setScreen('setup'); return; } setScreen('loading'); getTabletDeviceContext(deviceToken).then(data => { setContext(data); setScreen('ready'); }).catch(() => clearDevice()); }, [deviceToken]);
  const activate = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await signIn({ email: data.get('email'), password: data.get('password') }); const managerMembership = await getManagerTabletOrganization(); const result = await activateTabletDevice({ organizationId: managerMembership.organization_id, displayName: data.get('deviceName') }); localStorage.setItem(storageKey, result.deviceToken); await signOut(); setDeviceToken(result.deviceToken); show('태블릿이 사업장에 연결됐어요. 이제 직원 출퇴근을 시작할 수 있어요.'); } catch (error) { await signOut().catch(() => {}); const code = String(error?.message || ''); const notice = /invalid login credentials/i.test(code) ? '이메일 또는 비밀번호를 다시 확인해 주세요.' : code === 'tablet_manager_required' ? '사업장 관리자 계정으로 로그인해 주세요.' : /fetch|network|failed to fetch/i.test(code) ? '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' : '태블릿 연결을 완료하지 못했습니다. 관리자 권한과 사업장 설정을 확인해 주세요.'; show(notice, 'error'); } finally { setBusy(false); } };
  const lookup = async event => { event.preventDefault(); setBusy(true); try { setCandidate(await tabletAttendance({ deviceToken, phoneLast4: last4, action: 'lookup' })); } catch (error) { show(error.message === 'employee_not_found' ? '등록된 전화번호 뒷자리를 찾지 못했어요.' : '태블릿 연결 상태를 확인해 주세요.', 'error'); } finally { setBusy(false); } };
  const record = async () => { if (!candidate) return; setBusy(true); try { const result = await tabletAttendance({ deviceToken, phoneLast4: last4, action: candidate.nextAction }); setCandidate(null); setLast4(''); show(`${result.employeeName}님 ${candidate.nextAction === 'check_in' ? '출근' : '퇴근'} 기록을 저장했어요.`); } catch (error) { const code = String(error?.message || ''); const notice = code === 'tablet_device_not_active' ? '태블릿 연결이 해제됐어요. 관리자 연결이 필요합니다.' : code === 'already_checked_in' ? '이미 오늘 출근 기록이 있어요. 다시 확인하면 퇴근을 기록할 수 있어요.' : code === 'already_checked_out' ? '오늘의 퇴근 기록이 이미 완료됐어요.' : code === 'check_in_required' ? '먼저 출근 기록을 해주세요.' : code === 'employee_not_found' ? '등록된 직원 정보를 찾지 못했어요.' : code === 'invalid_payload' ? '입력한 전화번호를 다시 확인해 주세요.' : code ? `기록을 저장하지 못했어요. (${code})` : '기록을 저장하지 못했습니다. 다시 확인해 주세요.'; show(notice, 'error'); } finally { setBusy(false); } };
  const leave = async event => { event.preventDefault(); setBusy(true); try { setLeavePreview(await previewTabletLeaveRequest({ deviceToken, phoneLast8: last8, startsOn: leaveDate, endsOn: leaveDate, leaveType })); } catch (error) { const code = String(error?.message || ''); const notice = code === 'holiday_leave_not_allowed' || code === 'non_working_day' ? '선택한 날짜는 정기휴일 또는 공휴일이라 휴가를 신청할 수 없어요.' : code === 'employee_not_found' ? '등록된 전화번호 뒷 8자리 직원을 찾지 못했어요.' : code === 'invalid_payload' ? '전화번호·날짜·휴가 종류를 확인해 주세요.' : code === 'tablet_access_denied' || code === 'tablet_device_not_active' ? '태블릿 연결이 만료됐어요. 관리자 연결을 다시 진행해 주세요.' : '휴가 신청 정보를 확인해 주세요.'; show(notice, 'error'); } finally { setBusy(false); } };
  const submitLeave = async () => { if (!leavePreview) return; setBusy(true); try { const result = await tabletLeaveRequest({ deviceToken, phoneLast8: last8, startsOn: leaveDate, endsOn: leaveDate, leaveType }); setLast8(''); setLeaveDate(''); setLeavePreview(null); show(`${result.employeeName}님 휴가 신청이 완료됐어요.`); } catch (error) { setLeavePreview(null); show('휴가 신청을 저장하지 못했어요. 다시 확인해 주세요.', 'error'); } finally { setBusy(false); } };
  if (screen === 'loading') return <main className="tablet-page"><section className="tablet-shell"><section className="tablet-card"><LoadingBar label="태블릿 연결 정보를 확인하는 중…"/></section></section></main>;
  if (screen === 'setup') return <main className="tablet-page"><section className="tablet-shell"><aside className="tablet-identity"><div className="auth-brand"><span>✓</span><b>timefit</b></div><div><p>매장 운영 태블릿</p><h2>사업장에<br/>태블릿 연결</h2><span>관리자가 로그인해 이 기기를 사업장 전용 출퇴근 기기로 활성화합니다.</span></div></aside><section className="tablet-card"><div className="tablet-card-head"><div><p>TIMEFIT TABLET</p><h1>태블릿 연결</h1></div></div><div className="tablet-intro"><b>관리자 로그인으로 연결하세요</b><span>연결 후 관리자 계정은 이 태블릿에 유지되지 않습니다.</span></div><form className="tablet-form" onSubmit={activate}><label className="tablet-field"><span>기기 이름</span><input name="deviceName" defaultValue="매장 태블릿" required/><small>예: 성수점 카운터 태블릿</small></label><label className="tablet-field"><span>관리자 이메일</span><input name="email" type="email" required autoComplete="email"/></label><label className="tablet-field"><span>관리자 비밀번호</span><input name="password" type="password" required autoComplete="current-password"/></label><button className="submit tablet-submit" disabled={busy}>{busy ? '연결 중…' : '이 사업장 태블릿으로 연결'}</button></form></section></section>{message && <NoticeModal message={message} tone={tone} onClose={() => setMessage('')}/>}</main>;
  const updateLeaveDate = event => { setLeaveDate(event.currentTarget.value); setLeavePreview(null); };
  return <main className="tablet-page"><section className="tablet-shell"><aside className="tablet-identity"><div className="auth-brand"><span>✓</span><b>timefit</b></div><div><p>{context?.organizationName || '사업장'} · {context?.deviceName}</p><h2>{tab === 'attendance' ? '빠르고 정확한\n직원 출퇴근' : '간편한\n휴가 신청'}</h2><span>관리자 연결이 완료된 사업장 전용 태블릿입니다.</span></div></aside><section className="tablet-card"><div className="tablet-card-head"><div><p>TIMEFIT TABLET</p><h1>{tab === 'attendance' ? '출퇴근 기록' : '휴가 신청'}</h1></div><div className="tablet-status"><i/><span>연결됨</span></div></div><div className="tablet-tabs"><button className={tab === 'attendance' ? 'active' : ''} onClick={() => { setTab('attendance'); setCandidate(null); setLeavePreview(null); }}><b>◷</b> 출퇴근</button><button className={tab === 'leave' ? 'active' : ''} onClick={() => { setTab('leave'); setCandidate(null); }}><b>◫</b> 휴가 신청</button></div>{tab === 'attendance' ? <><div className="tablet-intro"><b>전화번호 뒷 4자리로 확인하세요</b><span>확인 후 출근 또는 퇴근 버튼이 표시됩니다.</span></div><form className="tablet-form" onSubmit={lookup}><label className="tablet-field"><span>전화번호 뒷 4자리</span><input inputMode="numeric" pattern="[0-9]*" maxLength="4" value={last4} onChange={event => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} required autoFocus/><small>직원 본인의 전화번호 끝 4자리</small></label><button className="submit tablet-submit" disabled={busy || last4.length !== 4}>{busy ? '확인 중…' : '직원 확인'}</button></form>{candidate && <div className="tablet-confirm"><span className="confirm-mark">✓</span><b>{candidate.employeeName}님이 맞나요?</b><p>확인 후 {candidate.nextAction === 'check_in' ? '출근' : '퇴근'} 기록이 저장됩니다.</p><div><button type="button" className="outline" onClick={() => setCandidate(null)}>다시 입력</button><button type="button" className="cta" disabled={busy} onClick={record}>{candidate.nextAction === 'check_in' ? '출근하기' : '퇴근하기'}</button></div></div>}</> : <form className="tablet-form" onSubmit={leave}><label className="tablet-field"><span>전화번호 뒷 8자리</span><input inputMode="numeric" pattern="[0-9]*" maxLength="8" value={last8} onChange={event => { setLast8(event.target.value.replace(/\D/g, '').slice(0, 8)); setLeavePreview(null); }} required/><small>직원 본인의 전화번호 끝 8자리</small></label><label className="tablet-field"><span>휴가 날짜</span><input name="date" type="date" min={todayKey} value={leaveDate} onInput={updateLeaveDate} onChange={updateLeaveDate} required/><small>오늘 이후 날짜만 신청할 수 있어요.</small></label><fieldset className="leave-type-picker"><legend>휴가 종류</legend><div>{['연차','오전 반차','오후 반차'].map(type => <button type="button" key={type} className={leaveType === type ? 'selected' : ''} onClick={() => { setLeaveType(type); setLeavePreview(null); }}><b>{type === '연차' ? '1일' : '.5일'}</b><span>{type}</span></button>)}</div></fieldset><button className="submit tablet-submit" disabled={busy || last8.length !== 8 || !leaveDate}>{busy ? '확인 중…' : '휴가 신청 내용 확인'}</button></form>}{leavePreview && <div className="tablet-confirm tablet-leave-confirm"><span className="confirm-mark">✓</span><b>{leavePreview.employeeName}님의 휴가 신청 내용을 확인해 주세요</b><p>{formatKoreanDate(leaveDate)} · {leaveType} · 차감 {leavePreview.amount}일</p><div><button type="button" className="outline" onClick={() => setLeavePreview(null)}>수정</button><button type="button" className="cta" disabled={busy} onClick={submitLeave}>{busy ? '신청 중…' : '신청 완료'}</button></div></div>}<button type="button" className="auth-switch" onClick={clearDevice}>태블릿 연결 해제</button></section></section>{message && <NoticeModal message={message} tone={tone} onClose={() => setMessage('')}/>}</main>;
}

function TabletApp() {
  const organizationId = new URLSearchParams(window.location.search).get('organization'); const [tab, setTab] = useState('attendance'); const [last4, setLast4] = useState(''); const [last8, setLast8] = useState(''); const [pin, setPin] = useState(''); const [leaveType, setLeaveType] = useState('연차'); const [candidate, setCandidate] = useState(null); const [message, setMessage] = useState(''); const [messageTone, setMessageTone] = useState('success'); const [busy, setBusy] = useState(false); const [keypadField, setKeypadField] = useState(null);
  const showMessage = (text, tone = 'success') => { setMessageTone(tone); setMessage(text); };
  const lookup = async event => { event.preventDefault(); setBusy(true); setMessage(''); try { setCandidate(await tabletAttendance({ organizationId, phoneLast4: last4, pin, action: 'lookup' })); } catch (error) { showMessage(error.message === 'employee_not_found' ? '등록된 전화번호 뒷자리를 찾지 못했어요.' : '태블릿 PIN 또는 입력 정보를 확인해 주세요.', 'error'); } finally { setBusy(false); } };
  const record = async action => { setBusy(true); try { const result = await tabletAttendance({ organizationId, phoneLast4: last4, pin, action }); setCandidate(null); setLast4(''); showMessage(`${result.employeeName}님 ${action === 'check_in' ? '출근' : '퇴근'} 기록을 저장했어요.`); } catch (error) { const code = error.message || ''; setCandidate(null); showMessage(code === 'already_checked_in' ? '이미 출근 기록이 있어요. 다시 확인하면 퇴근을 기록할 수 있어요.' : code === 'already_checked_out' ? '오늘의 퇴근 기록이 이미 완료됐어요.' : code === 'check_in_required' ? '먼저 출근 기록을 해주세요.' : '기록을 저장하지 못했습니다. 다시 확인해 주세요.', 'error'); } finally { setBusy(false); } };
  const leave = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { const result = await tabletLeaveRequest({ organizationId, pin, phoneLast8: last8, startsOn: data.get('date'), endsOn: data.get('date'), leaveType }); setLast8(''); showMessage(result.notificationStatus === 'queued' ? `${result.employeeName}님 휴가 신청이 완료됐어요. 관리자 알림 발송 대기열에 등록했어요.` : `${result.employeeName}님 휴가 신청이 완료됐어요. 관리자 전화번호를 등록하면 알림을 발송할 수 있어요.`); } catch (error) { const code = error.message || ''; showMessage(code === 'invalid_date' ? '오늘 이후 날짜만 신청할 수 있어요.' : code === 'employee_not_found' ? '등록된 직원 정보를 찾지 못했어요.' : code === 'tablet_access_denied' ? '태블릿 PIN 또는 활성화 상태를 확인해 주세요.' : '휴가 신청 정보를 확인해 주세요.', 'error'); } finally { setBusy(false); } };
  const numericField = (label, value, onChange, maxLength, hint) => <label className="tablet-field"><span>{label}</span><button type="button" className="tablet-numeric-trigger" aria-label={label} onClick={()=>setKeypadField({ label, value, onChange, maxLength })}>{value || '숫자를 입력해 주세요'}</button><small>{hint}</small></label>;
  const keypadInput = key => { if (!keypadField) return; keypadField.onChange(`${keypadField.value}${key}`.slice(0, keypadField.maxLength)); setKeypadField(field => field ? { ...field, value: `${field.value}${key}`.slice(0, field.maxLength) } : field); };
  const keypadBackspace = () => { if (!keypadField) return; keypadField.onChange(keypadField.value.slice(0, -1)); setKeypadField(field => field ? { ...field, value: field.value.slice(0, -1) } : field); };
  return <main className="tablet-page"><section className="tablet-shell"><aside className="tablet-identity"><div className="auth-brand"><span>✓</span><b>timefit</b></div><div><p>매장 운영 태블릿</p><h2>{tab === 'attendance' ? '빠르고 정확한\n직원 출퇴근' : '간편한\n휴가 신청'}</h2><span>전화번호 뒷자리와 매장 PIN으로 안전하게 확인합니다.</span></div><div className="tablet-help"><b>사용 안내</b><span>개인 정보는 화면에 남지 않으며, 처리 후 자동으로 초기화됩니다.</span></div></aside><section className="tablet-card"><div className="tablet-card-head"><div><p>TIMEFIT TABLET</p><h1>{tab === 'attendance' ? '출퇴근 기록' : '휴가 신청'}</h1></div><div className="tablet-status"><i/><span>운영 중</span></div></div><div className="tablet-tabs"><button className={tab==='attendance'?'active':''} onClick={()=>{setTab('attendance');setMessage('');setCandidate(null)}}><b>◷</b> 출퇴근</button><button className={tab==='leave'?'active':''} onClick={()=>{setTab('leave');setMessage('');setCandidate(null)}}><b>◫</b> 휴가 신청</button></div>{tab==='attendance'?<><div className="tablet-intro"><b>직원 확인 후 기록하세요</b><span>출근 또는 퇴근 버튼이 다음 단계에서 표시됩니다.</span></div><form className="tablet-form" onSubmit={lookup}>{numericField('태블릿 PIN',pin,setPin,4,'관리자가 설정한 4자리 PIN')}{numericField('전화번호 뒷 4자리',last4,setLast4,4,'직원 본인의 전화번호 끝 4자리')}<button className="submit tablet-submit" disabled={busy||!organizationId}>{busy?'확인 중…':'직원 확인'}</button></form>{candidate&&<div className="tablet-confirm"><span className="confirm-mark">✓</span><b>{candidate.employeeName}님이 맞나요?</b><p>확인 후 {candidate.nextAction==='check_in'?'출근':'퇴근'} 기록이 저장됩니다.</p><div><button type="button" className="outline" onClick={()=>setCandidate(null)}>다시 입력</button><button type="button" className="cta" onClick={()=>record(candidate.nextAction)}>{candidate.nextAction==='check_in'?'출근하기':'퇴근하기'}</button></div></div>}</>:<form className="tablet-form" onSubmit={leave}>{numericField('태블릿 PIN',pin,setPin,4,'관리자가 설정한 4자리 PIN')}{numericField('전화번호 뒷 8자리',last8,setLast8,8,'직원 본인의 전화번호 끝 8자리')}<label className="tablet-field"><span>휴가 날짜</span><input name="date" type="date" min={new Date().toLocaleDateString('en-CA')} required/><small>오늘 이후 날짜만 신청할 수 있어요.</small></label><fieldset className="leave-type-picker"><legend>휴가 종류</legend><div>{['연차','오전 반차','오후 반차'].map(type=><button type="button" key={type} className={leaveType===type?'selected':''} onClick={()=>setLeaveType(type)}><b>{type==='연차'?'1일':'.5일'}</b><span>{type}</span></button>)}</div></fieldset><button className="submit tablet-submit" disabled={busy||!organizationId}>{busy?'신청 중…':'휴가 신청하기'}</button></form>}<p className="tablet-footer">개인 정보는 출퇴근 및 휴가 신청 확인에만 사용됩니다.</p></section></section>{keypadField&&<Modal title={keypadField.label} onClose={()=>setKeypadField(null)} variant="tablet-modal"><div className="tablet-keypad-value">{keypadField.value || '숫자를 입력해 주세요'}</div><div className="tablet-keypad">{[1,2,3,4,5,6,7,8,9].map(key=><button type="button" key={key} onClick={()=>keypadInput(String(key))}>{key}</button>)}<button type="button" onClick={()=>keypadInput('0')}>0</button><button type="button" className="keypad-backspace" onClick={keypadBackspace} aria-label="한 자리 삭제">←</button></div><button type="button" className="submit tablet-submit" onClick={()=>setKeypadField(null)}>입력 완료</button></Modal>}{message&&<NoticeModal message={message} tone={messageTone} onClose={()=>setMessage('')}/>}</main>;
}

function Settings({ organizationId, organizationName, onSaved }) {
  const [form, setForm] = useState({ workplace_name: organizationName || '', address: '', standard_break_minutes: 60, tablet_pin: '0000', tablet_enabled: true, shift_types: DEFAULT_SHIFT_TYPES, shift_type_colors: DEFAULT_SHIFT_COLORS, ...DEFAULT_LEAVE_POLICY }); const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [newShiftType, setNewShiftType] = useState(''); const [holidayDate, setHolidayDate] = useState('');
  useEffect(() => { getOrganizationSettings(organizationId).then(data => { if (data) setForm(current => ({ ...current, ...DEFAULT_LEAVE_POLICY, ...data, weekly_holiday_weekdays: data.weekly_holiday_weekdays || [0], public_holiday_dates: data.public_holiday_dates || [] })); }).catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, [organizationId]);
  const save = async e => { e.preventDefault(); try { const saved = await saveOrganizationSettings({ ...form, organization_id: organizationId, standard_break_minutes: Number(form.standard_break_minutes), annual_leave_grant_days: Number(form.annual_leave_grant_days), annual_leave_grant_after_months: Number(form.annual_leave_grant_after_months), monthly_leave_grant_days: Number(form.monthly_leave_grant_days), monthly_leave_min_scheduled_days: Number(form.monthly_leave_min_scheduled_days) }); window.dispatchEvent(new CustomEvent('timefit:settings-saved', { detail: saved })); setMessage('운영 설정을 저장했어요.'); onSaved?.(); } catch (error) { setMessage(error.message || '저장하지 못했습니다.'); } };
  const tabletUrl = `${window.location.origin}/tablet?organization=${organizationId}`;
  const shiftTypes = form.shift_types?.length ? form.shift_types : DEFAULT_SHIFT_TYPES;
  const shiftColors = { ...DEFAULT_SHIFT_COLORS, ...(form.shift_type_colors || {}) };
  const setShiftColor = (type, color) => setForm(current => ({ ...current, shift_type_colors: { ...DEFAULT_SHIFT_COLORS, ...(current.shift_type_colors || {}), [type]: color } }));
  const addShiftType = () => { const value = newShiftType.trim(); if (!value) return; if (shiftTypes.includes(value)) return setMessage('이미 등록된 근무 형태입니다.'); setForm({ ...form, shift_types: [...shiftTypes, value] }); setNewShiftType(''); };
  const addHoliday = () => { const value = holidayDate || document.querySelector('.holiday-date-add input')?.value || ''; if (!value) return setMessage('공휴일 날짜를 먼저 선택해 주세요.'); if ((form.public_holiday_dates || []).includes(value)) return setMessage('이미 등록된 공휴일입니다.'); setForm(current => ({ ...current, public_holiday_dates: [...(current.public_holiday_dates || []), value].sort() })); setHolidayDate(''); };
  const copyTabletUrl = async () => { try { await navigator.clipboard.writeText(tabletUrl); setMessage('태블릿 주소를 복사했어요.'); } catch { setMessage('주소를 복사하지 못했습니다.'); } };
  return <><div className="page-title settings-title"><div><p>관리자 전용</p><h1>운영 설정</h1><span>사업장 운영 기준과 태블릿 출퇴근 환경을 관리하세요.</span></div></div><section className="card settings-card">{loading ? <p className="settings-loading">설정을 불러오는 중입니다.</p> : <form className="settings-form" onSubmit={save}><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">⌂</span><div><h2>사업장 기본 정보</h2><p>화면과 태블릿에 표시되는 운영 정보입니다.</p></div></div><div className="settings-input-grid"><label>사업장 표시 이름<input value={form.workplace_name || ''} onChange={e => setForm({...form,workplace_name:e.target.value})} required/></label><label>사업장 주소<input value={form.address || ''} onChange={e => setForm({...form,address:e.target.value})} placeholder="주소를 입력해 주세요"/></label><label>기본 휴게시간<span className="input-with-unit"><input type="number" min="0" max="480" value={form.standard_break_minutes} onChange={e => setForm({...form,standard_break_minutes:e.target.value})}/><em>분</em></span></label></div></section><section className="settings-section shift-type-settings"><div className="settings-section-head"><span className="settings-icon">▦</span><div><h2>근무 형태·색상 관리</h2><p>근무별 색상은 스케줄 PDF의 배경과 상단 구분선에 적용됩니다.</p></div></div><div className="shift-color-list">{shiftTypes.map(type => <div className="shift-color-row" key={type}><label><input type="color" value={shiftColors[type] || '#64748B'} onChange={event => setShiftColor(type,event.target.value.toUpperCase())}/><i style={{background:shiftColors[type] || '#64748B'}}/><b>{type}</b><code>{shiftColors[type] || '#64748B'}</code></label><button type="button" aria-label={`${type} 삭제`} onClick={() => setForm({ ...form, shift_types: shiftTypes.filter(item => item !== type) })}>삭제</button></div>)}</div><div className="shift-type-add"><input value={newShiftType} onChange={event => setNewShiftType(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addShiftType(); } }} placeholder="예: 주말 풀타임"/><button type="button" className="outline" onClick={addShiftType}>+ 형태 추가</button></div></section><section className="settings-section tablet-settings"><div className="settings-section-head"><span className="settings-icon">▣</span><div><h2>태블릿 출퇴근</h2><p>전화번호 뒷 4자리와 매장 PIN으로 출퇴근을 기록합니다.</p></div></div><div className="tablet-setting-row"><label>태블릿 PIN<span className="pin-input"><input inputMode="numeric" maxLength="4" value={form.tablet_pin || ''} onChange={e => setForm({...form,tablet_pin:e.target.value.replace(/\D/g,'').slice(0,4)})} required/></span></label><label className="toggle-label"><input type="checkbox" checked={form.tablet_enabled} onChange={e => setForm({...form,tablet_enabled:e.target.checked})}/><span><i/></span><b>태블릿 출퇴근 활성화</b></label></div><div className="tablet-url"><div><small>태블릿 전용 접속 주소</small><code>{tabletUrl}</code></div><button type="button" className="outline" onClick={copyTabletUrl}>주소 복사</button></div></section><button className="submit settings-save">설정 저장</button></form>}</section>{message&&<NoticeModal message={message} tone={/못|오류|필요|입력/.test(message)?'error':'success'} onClose={()=>setMessage('')}/>}</>;
}

function FinanceFeeSettings({ organizationId }) {
  const [feePercent, setFeePercent] = useState('2.2');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    getOrganizationSettings(organizationId)
      .then(settings => setFeePercent(String(Number(settings?.corporate_card_fee_rate ?? 0.022) * 100)))
      .catch(error => setMessage(error.message || '카드수수료 설정을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [organizationId]);
  const save = async event => {
    event.preventDefault();
    const percent = Number(feePercent);
    if (!feePercent.trim() || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      setMessage('카드수수료율을 0~100% 사이의 숫자로 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const settings = await updateOrganizationCardFeeRate(organizationId, percent / 100);
      setFeePercent(String(Number(settings.corporate_card_fee_rate) * 100));
      invalidateFinanceReportCache(organizationId);
      window.dispatchEvent(new CustomEvent('timefit:finance-rates-saved', { detail: { organizationId } }));
      setMessage('카드수수료율을 저장했어요. 다음 손익 조회부터 새 비율이 반영됩니다.');
    } catch (error) { setMessage(error.message || '카드수수료율을 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };
  return <section className="card settings-card finance-fee-settings"><section className="settings-section">
    <div className="settings-section-head"><span className="settings-icon">₩</span><div><h2>손익 계산 · 카드수수료</h2><p>사업장별 카드수수료 추정 비율을 설정합니다.</p></div></div>
    {loading ? <LoadingBar label="카드수수료 설정을 불러오는 중…"/> : <form className="settings-form" onSubmit={save}>
      <div className="settings-input-grid"><label>카드수수료율<span className="input-with-unit"><input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={feePercent} onChange={event => setFeePercent(event.target.value)} required aria-describedby="finance-fee-help"/><em>%</em></span></label></div>
      <p id="finance-fee-help" className="settings-help">완료 매출 × 입력한 수수료율로 추정 카드수수료를 계산해 운영지출과 순익에 반영합니다. 실제 카드사 청구액과는 다를 수 있습니다.</p>
      <p className="settings-help">비율 변경 시 기존 기간의 조회 보고서는 다시 계산됩니다. 이미 저장한 결산 스냅샷은 자동으로 변경되지 않습니다.</p>
      <button className="submit settings-save" disabled={saving}>{saving ? '저장 중…' : '카드수수료율 저장'}</button>
    </form>}
  </section>{message && <NoticeModal message={message} tone={/못|입력/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function ManagementAccountSettings({ organizationId, employees, isOwner }) {
  const [accounts,setAccounts]=useState([]); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [credentials,setCredentials]=useState(null); const [chapter,setChapter]=useState('accounts'); const [editing,setEditing]=useState(null);
  const refresh=()=>isOwner&&loadManagementAccounts(organizationId).then(setAccounts).catch(error=>setMessage(error.message||'관리 계정을 불러오지 못했습니다.'));
  useEffect(()=>{refresh();},[organizationId,isOwner]);
  if(!isOwner) return null;
  const submit=async event=>{event.preventDefault();const formElement=event.currentTarget;const form=new FormData(formElement);setBusy(true);try{const result=await createManagementAccount({organizationId,displayName:form.get('displayName'),loginId:form.get('loginId'),temporaryPassword:form.get('temporaryPassword'),roleCode:form.get('roleCode'),staffId:form.get('staffId')||null,categoryIds:form.getAll('categoryIds'),permissions:form.getAll('permissions')});setCredentials({loginId:result.loginId,password:form.get('temporaryPassword')});formElement.reset();await refresh();setMessage('관리 계정을 만들었어요. 아이디와 임시 비밀번호를 안전하게 전달해 주세요.');}catch(error){setMessage(/already|duplicate/.test(error.message)?'이미 사용 중인 관리자 아이디입니다.':error.message||'관리 계정을 만들지 못했습니다.');}finally{setBusy(false);}};
  const categories=[...new Map(employees.filter(e=>e.categoryId).map(e=>[e.categoryId,{id:e.categoryId,name:e.team}])).values()];
  const permissionOptions = [
    ['dashboard.view','홈','사업장 현황'], ['attendance.view','출퇴근 조회','근태 기록'],
    ['schedule.view','스케줄 조회','일정 열람'], ['schedule.manage','스케줄 작성·수정','승인 요청'],
    ['leave.view','휴가 조회','연차 현황'], ['payroll.view','급여 조회 · 사업장 전체','부서 범위와 무관하게 모든 직원의 급여를 조회합니다. 저장·계약 변경은 최고관리자만 가능합니다.'],
    ['employee.view','직원 기본정보 조회','프로필 열람'],
    ['settings.manage','운영 설정 관리','근무 형태·색상과 태블릿 설정'],
    ['finance.view','지출·손익 조회','전체 사업장 지출·손익과 인건비 합계 열람'],
    ['expense.manage','지출·증빙 작성','지출 등록과 증빙 검토'],
    ['sales.view','매출 조회','전체 사업장 매출과 인건비 합계 열람'],
    ['sales.sync','매출 수동 동기화','Toss 주문 수집을 직접 실행'],
  ];
  const permissionName = Object.fromEntries(permissionOptions.map(([value,label])=>[value,label]));
  const employeeById = Object.fromEntries(employees.map(employee=>[employee.id,employee]));
  const openEditor=account=>setEditing({account,roleCode:account.role_code,staffId:account.staff_id||'',status:account.status,permissions:(account.timefit_user_management_permissions||[]).filter(item=>item.allowed!==false).map(item=>item.permission_code),categoryIds:(account.timefit_user_management_scopes||[]).map(item=>item.category_id)});
  const toggleEditorValue=(key,value)=>setEditing(current=>({...current,[key]:current[key].includes(value)?current[key].filter(item=>item!==value):[...current[key],value]}));
  const saveAccount=async()=>{setBusy(true);try{await manageManagementAccount({action:'update',organizationId,accountId:editing.account.id,roleCode:editing.roleCode,staffId:editing.staffId||null,status:editing.status,permissions:editing.permissions,categoryIds:editing.categoryIds});setEditing(null);await refresh();setMessage('관리자 계정 설정을 저장했어요.');}catch(error){setMessage(error.message||'관리자 계정을 수정하지 못했습니다.');}finally{setBusy(false);}};
  const removeAccount=async account=>{if(!window.confirm(`${account.login_id} 관리자 계정을 삭제할까요?\n삭제하면 해당 아이디로 더 이상 로그인할 수 없습니다.`))return;setBusy(true);try{await manageManagementAccount({action:'delete',organizationId,accountId:account.id});if(editing?.account.id===account.id)setEditing(null);await refresh();setMessage('관리자 계정을 삭제했어요.');}catch(error){setMessage(error.message||'관리자 계정을 삭제하지 못했습니다.');}finally{setBusy(false);}};
  return <section className="card settings-card management-account-settings">
    <section className="management-account-heading"><div><span className="settings-icon">♙</span><div><h2>권한형 관리자 계정</h2><p>로그인 아이디를 기준으로 담당 범위와 허용 기능을 관리합니다.</p></div></div><span className="management-count">활성 관리자 {accounts.filter(account=>account.status==='active').length}명</span></section>
    <nav className="management-chapters" aria-label="관리자 계정 관리"><button type="button" className={chapter==='accounts'?'active':''} onClick={()=>setChapter('accounts')}><b>연결된 관리자</b><small>확인 · 수정 · 삭제</small><span>{accounts.length}</span></button><button type="button" className={chapter==='create'?'active':''} onClick={()=>setChapter('create')}><b>새 관리자 등록</b><small>아이디 · 권한 발급</small><span>＋</span></button></nav>
    {chapter==='create'&&<>
    <form className="settings-form management-account-form" onSubmit={submit}><section className="settings-section">
      <div className="settings-input-grid management-identity-grid"><label>표시 이름<input name="displayName" required placeholder="예: 홀 매니저"/></label><label>로그인 아이디<input name="loginId" pattern="[a-zA-Z0-9._-]{4,30}" required placeholder="예: hall.manager"/><small>화면에는 이 아이디가 관리자 식별자로 표시됩니다.</small></label><label>임시 비밀번호<input name="temporaryPassword" type="password" minLength="8" required autoComplete="new-password"/></label><label>역할<select name="roleCode" defaultValue="manager"><option value="manager">매니저</option><option value="executive_chef">총괄셰프</option></select></label><label className="management-staff-link">연결 직원<select name="staffId" defaultValue=""><option value="">연결 안 함</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} · {e.team}</option>)}</select><small>본인 출퇴근 기능이 필요할 때만 연결합니다.</small></label></div>
      <fieldset className="management-permissions"><legend>허용 기능 <small>업무에 필요한 항목만 선택</small></legend><div className="management-option-grid">{permissionOptions.map(([value,label,description])=><label key={value}><input type="checkbox" name="permissions" value={value} defaultChecked={['dashboard.view','schedule.view','schedule.manage','employee.view'].includes(value)}/><span><b>{label}</b><small>{description}</small></span></label>)}</div></fieldset>
      <fieldset className="management-permissions"><legend>담당 구분 <small>직원·스케줄 업무에 적용, 급여·매출·지출 조회는 사업장 전체</small></legend><div className="management-option-grid category-options">{categories.map(category=><label key={category.id}><input type="checkbox" name="categoryIds" value={category.id}/><span><b>{category.name}</b><small>해당 구분 직원만 담당</small></span></label>)}</div></fieldset>
      <button className="submit management-create" disabled={busy}>{busy?'계정 생성 중…':'관리 계정 생성'}</button>
    </section></form>
    {credentials&&<div className="issued-credentials"><b>이번에 발급한 로그인 정보</b><code>아이디 {credentials.loginId}</code><code>임시 비밀번호 {credentials.password}</code><small>이 창을 닫으면 비밀번호를 다시 표시하지 않습니다.</small><button className="outline" onClick={()=>setCredentials(null)}>확인</button></div>}
    </>}
    {chapter==='accounts'&&<section className="management-account-list"><div className="management-list-title"><div><h3>연결된 관리자 계정</h3><p>아이디별 역할과 권한을 확인하고 변경하거나 삭제할 수 있습니다.</p></div></div><div className="management-account-cards">{accounts.length?accounts.map(account=>{const granted=(account.timefit_user_management_permissions||[]).filter(item=>item.allowed!==false).map(item=>permissionName[item.permission_code]).filter(Boolean);const linked=employeeById[account.staff_id];return <article key={account.id} className="management-account-card"><div className="management-account-avatar">{account.login_id.slice(0,2).toUpperCase()}</div><div className="management-account-info"><code>{account.login_id}</code><span>{account.role_code==='executive_chef'?'총괄셰프':'매니저'}{linked?` · ${linked.name} 연결`:' · 직원 연결 없음'}</span><div>{granted.map(label=><small key={label}>{label}</small>)}</div></div><div className="management-account-actions"><Chip type={account.status==='active'?'green':'gray'}>{account.status==='active'?'활성':'중지'}</Chip><button type="button" className="outline" onClick={()=>openEditor(account)}>확인 · 수정</button><button type="button" className="management-delete" onClick={()=>removeAccount(account)} disabled={busy}>삭제</button></div></article>}):<p className="empty-state">연결된 관리자 계정이 없습니다.</p>}</div></section>}
    {editing&&<Modal title="관리자 계정 확인 · 수정" onClose={()=>!busy&&setEditing(null)}><div className="management-editor"><div className="management-editor-id"><small>로그인 아이디</small><code>{editing.account.login_id}</code><span>아이디는 계정 식별을 위해 변경할 수 없습니다.</span></div><div className="form-row"><label>역할<select value={editing.roleCode} onChange={event=>setEditing({...editing,roleCode:event.target.value})}><option value="manager">매니저</option><option value="executive_chef">총괄셰프</option></select></label><label>계정 상태<select value={editing.status} onChange={event=>setEditing({...editing,status:event.target.value})}><option value="active">활성</option><option value="suspended">사용 중지</option></select></label></div><label>연결 직원<select value={editing.staffId} onChange={event=>setEditing({...editing,staffId:event.target.value})}><option value="">연결 안 함</option>{employees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.team}</option>)}</select></label><fieldset className="management-permissions"><legend>허용 기능</legend><div className="management-option-grid">{permissionOptions.map(([value,label,description])=><label key={value}><input type="checkbox" checked={editing.permissions.includes(value)} onChange={()=>toggleEditorValue('permissions',value)}/><span><b>{label}</b><small>{description}</small></span></label>)}</div></fieldset><fieldset className="management-permissions"><legend>담당 구분 <small>직원·스케줄 업무에 적용, 급여·매출·지출 조회는 사업장 전체</small></legend><div className="management-option-grid category-options">{categories.map(category=><label key={category.id}><input type="checkbox" checked={editing.categoryIds.includes(category.id)} onChange={()=>toggleEditorValue('categoryIds',category.id)}/><span><b>{category.name}</b><small>해당 구분 직원만 담당</small></span></label>)}</div></fieldset><div className="management-editor-actions"><button type="button" className="management-delete" onClick={()=>removeAccount(editing.account)} disabled={busy}>계정 삭제</button><button type="button" className="submit" onClick={saveAccount} disabled={busy}>{busy?'저장 중…':'변경사항 저장'}</button></div></div></Modal>}
    {message&&<NoticeModal message={message} tone={/못|이미/.test(message)?'error':'success'} onClose={()=>setMessage('')}/>}</section>;
}

function TabletDeviceSettings({ organizationId }) {
  const [devices, setDevices] = useState([]); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('');
  const refresh = () => { setLoading(true); loadTabletDevices(organizationId).then(setDevices).catch(error => setMessage(error.message || '태블릿 목록을 불러오지 못했습니다.')).finally(() => setLoading(false)); };
  useEffect(() => { refresh(); }, [organizationId]);
  const revoke = async device => { if (!window.confirm(`${device.display_name} 연결을 해제할까요? 해당 태블릿은 즉시 관리자 재연결이 필요합니다.`)) return; try { await revokeTabletDevice(device.id); refresh(); setMessage('태블릿 연결을 해제했어요.'); } catch { setMessage('태블릿 연결을 해제하지 못했습니다.'); } };
  return <section className="card settings-card holiday-compensation-card"><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">▣</span><div><h2>연결된 태블릿</h2><p>태블릿은 관리자 로그인으로 사업장에 연결됩니다. PIN은 더 이상 사용하지 않습니다.</p></div></div>{loading ? <LoadingBar label="연결된 태블릿을 불러오는 중…"/> : <div className="tablet-device-list">{devices.length ? devices.map(device => <div key={device.id} className="tablet-device-row"><div><b>{device.display_name}</b><span>마지막 사용 {device.last_used_at ? new Date(device.last_used_at).toLocaleString('ko-KR') : '없음'} · 만료 {new Date(device.expires_at).toLocaleDateString('ko-KR')}</span></div><button type="button" className="outline" onClick={() => revoke(device)}>연결 해제</button></div>) : <p className="empty-state">연결된 태블릿이 없어요. 태블릿에서 관리자 로그인 후 연결해 주세요.</p>}<div className="tablet-url"><div><small>태블릿 전용 접속 주소</small><code>{window.location.origin}/tablet</code></div></div></div>}</section>{message && <NoticeModal message={message} tone={/못/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function TossPlaceConnectionSettings({ organizationId }) {
  const [form, setForm] = useState({ display_name: 'Toss Place', service_id: '', service_code: '', merchant_id: '', sync_enabled: true });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [customCredentials, setCustomCredentials] = useState({ accessKey: '', accessSecret: '' });
  useEffect(() => { getTossPlaceConnection(organizationId).then(data => { if (data) setForm({ display_name: data.display_name || 'Toss Place', service_id: data.service_id || '', service_code: data.service_code || '', merchant_id: data.merchant_id || '', sync_enabled: data.sync_enabled !== false }); }).catch(error => setMessage(error.message || 'Toss 연결 정보를 불러오지 못했습니다.')).finally(() => setLoading(false)); }, [organizationId]);
  const save = async event => { event.preventDefault(); setBusy(true); try { const saved = await saveTossPlaceConnection({ ...form, organization_id: organizationId }); setForm(current => ({ ...current, merchant_id: saved.merchant_id || '' })); setMessage(saved.merchant_id ? 'Toss Place 연결 정보를 저장했어요. 다음 동기화부터 이 사업장 매출로 분리됩니다.' : '서비스 연결 정보를 저장했어요. 매출 동기화에는 Toss 판매점 ID도 추가해 주세요.'); } catch (error) { setMessage(error.message || 'Toss 연결 정보를 저장하지 못했습니다.'); } finally { setBusy(false); } };
  const connectServerAccount = async () => { if (!form.service_id.trim() || !form.service_code.trim()) return setMessage('서비스 ID와 서비스 코드를 먼저 입력해 주세요.'); setBusy(true); try { const saved = await bootstrapTossPlaceConnection({ organizationId, displayName: form.display_name, serviceId: form.service_id, serviceCode: form.service_code }); setForm(current => ({ ...current, merchant_id: saved.merchant_id || '' })); setMessage('현재 서버에 등록된 Toss Place 계정을 이 사업장에 연결했어요.'); } catch (error) { setMessage(error.message || '현재 서버 계정을 연결하지 못했습니다.'); } finally { setBusy(false); } };
  const saveCustomCredentials = async () => { if (!form.service_id.trim() || !form.service_code.trim()) return setMessage('서비스 ID와 서비스 코드를 먼저 저장해 주세요.'); setBusy(true); try { await saveTossPlaceConnection({ ...form, organization_id: organizationId }); await saveCustomTossPlaceCredentials({ organizationId, ...customCredentials }); setCustomCredentials({ accessKey: '', accessSecret: '' }); setMessage('맞춤 Toss API 인증 정보를 안전하게 저장했어요. 키는 다시 표시되지 않습니다.'); } catch (error) { setMessage(error.message || '맞춤 인증 정보를 저장하지 못했습니다.'); } finally { setBusy(false); } };
  return <section className="card settings-card holiday-compensation-card"><form className="settings-form" onSubmit={save}><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">₮</span><div><h2>Toss Place 매출 연결</h2><p>사업장별 서비스 연결 정보를 저장합니다. 인증 키는 서버에서 암호화해 저장하고 다시 표시하지 않습니다.</p></div></div>{loading ? <LoadingBar label="Toss Place 연결 정보를 불러오는 중…"/> : <><div className="settings-input-grid"><label>표시 이름<input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="예: 버터빌라 Toss Place" required/></label><label>서비스 ID<input value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })} placeholder="예: butter-villa" required/></label><label>서비스 코드<input value={form.service_code} onChange={e => setForm({ ...form, service_code: e.target.value.toUpperCase() })} placeholder="예: NBV2QWFJ" required/></label><label>Toss 판매점 ID <small>(Open API용)</small><input inputMode="numeric" value={form.merchant_id} onChange={e => setForm({ ...form, merchant_id: e.target.value.replace(/\D/g, '') })} placeholder="개발자센터의 숫자 ID"/></label></div><div className="settings-actions"><button type="button" className="outline" onClick={connectServerAccount} disabled={busy}>현재 서버에 연결된 Toss 계정 사용</button></div><label className="toggle-label"><input type="checkbox" checked={form.sync_enabled} onChange={e => setForm({ ...form, sync_enabled: e.target.checked })}/><span><i/></span><b>매일 매출 동기화 사용</b></label><p className="settings-help">서비스 ID·코드는 Toss POS의 ‘코드로 연결하기’에 사용합니다. 판매점 ID는 Open API 주문 조회를 위한 숫자 식별자이며, 서비스 ID와는 다를 수 있습니다.</p></>}</section><button className="submit settings-save" disabled={loading || busy}>{busy ? '저장 중…' : 'Toss 연결 정보 저장'}</button></form><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">⌁</span><div><h2>맞춤 API 인증정보</h2><p>다른 Toss 개발자 앱을 쓰는 사업장만 입력하세요. 입력 즉시 암호화되며 이후에는 새 값으로 교체만 가능합니다.</p></div></div><div className="settings-input-grid"><label>Access Key<input autoComplete="off" value={customCredentials.accessKey} onChange={e => setCustomCredentials({ ...customCredentials, accessKey: e.target.value })} placeholder="Toss 개발자센터 Access Key"/></label><label>Access Secret<input type="password" autoComplete="new-password" value={customCredentials.accessSecret} onChange={e => setCustomCredentials({ ...customCredentials, accessSecret: e.target.value })} placeholder="Toss 개발자센터 Access Secret"/></label></div><button type="button" className="outline" onClick={saveCustomCredentials} disabled={busy}>맞춤 인증정보 안전 저장</button></section>{message && <NoticeModal message={message} tone={/못/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function LeavePolicySettings({ organizationId, onSaved }) {
  const [form, setForm] = useState(DEFAULT_LEAVE_POLICY); const [holidayDate, setHolidayDate] = useState(''); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('');
  useEffect(() => { getOrganizationSettings(organizationId).then(data => setForm({ ...DEFAULT_LEAVE_POLICY, ...(data || {}), weekly_holiday_weekdays: data?.weekly_holiday_weekdays || [0], public_holiday_dates: data?.public_holiday_dates || [] })).catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, [organizationId]);
  const save = async event => { event.preventDefault(); try { await saveOrganizationSettings({ ...form, organization_id: organizationId, annual_leave_grant_days: Number(form.annual_leave_grant_days), annual_leave_grant_after_months: Number(form.annual_leave_grant_after_months), monthly_leave_grant_days: Number(form.monthly_leave_grant_days), monthly_leave_min_scheduled_days: Number(form.monthly_leave_min_scheduled_days) }); setMessage('연차·월차·휴일 계산 기준을 저장했어요.'); onSaved?.(); } catch (error) { setMessage(error.message || '저장하지 못했습니다.'); } };
  const addHoliday = () => { const value = holidayDate || document.querySelector('.holiday-date-add input')?.value || ''; if (!value) return setMessage('공휴일 날짜를 먼저 선택해 주세요.'); if ((form.public_holiday_dates || []).includes(value)) return setMessage('이미 등록된 공휴일입니다.'); setForm(current => ({ ...current, public_holiday_dates: [...(current.public_holiday_dates || []), value].sort() })); setHolidayDate(''); };
  const toggleWeekday = index => setForm({ ...form, weekly_holiday_weekdays: (form.weekly_holiday_weekdays || []).includes(index) ? form.weekly_holiday_weekdays.filter(value => value !== index) : [...(form.weekly_holiday_weekdays || []), index].sort() });
  return <section className="card settings-card leave-policy-card">{loading ? <LoadingBar label="연차 정책을 불러오는 중…"/> : <form className="settings-form" onSubmit={save}><section className="settings-section leave-policy-settings"><div className="settings-section-head"><span className="settings-icon">◫</span><div><h2>연차 · 월차 · 휴일 계산</h2><p>직원별 발생·잔여 연차와 휴가 신청 일수에 바로 적용됩니다.</p></div></div><div className="settings-input-grid leave-policy-grid"><label>연차 부여 일수<span className="input-with-unit"><input type="number" min="0" max="30" step="0.5" value={form.annual_leave_grant_days} onChange={e => setForm({...form,annual_leave_grant_days:e.target.value})}/><em>일</em></span></label><label>연차 부여 조건<span className="input-with-unit"><input type="number" min="1" max="60" value={form.annual_leave_grant_after_months} onChange={e => setForm({...form,annual_leave_grant_after_months:e.target.value})}/><em>개월 재직</em></span></label></div><div className="leave-policy-monthly"><label className="toggle-label"><input type="checkbox" checked={Boolean(form.monthly_leave_enabled)} onChange={e => setForm({...form,monthly_leave_enabled:e.target.checked})}/><span><i/></span><b>입사 1년 미만 월차 자동 발생</b></label>{form.monthly_leave_enabled && <div className="settings-input-grid leave-policy-grid"><label>월차 발생 일수<span className="input-with-unit"><input type="number" min="0" max="3" step="0.5" value={form.monthly_leave_grant_days} onChange={e => setForm({...form,monthly_leave_grant_days:e.target.value})}/><em>일/월</em></span></label><label>월차 생성 조건<span className="input-with-unit"><input type="number" min="0" max="31" value={form.monthly_leave_min_scheduled_days} onChange={e => setForm({...form,monthly_leave_min_scheduled_days:e.target.value})}/><em>일 이상 근무</em></span></label></div>}<p className="settings-help">월별 스케줄에 등록된 실제 근무일을 기준으로 월차 조건을 확인합니다.</p></div><div className="holiday-policy"><label className="toggle-label"><input type="checkbox" checked={Boolean(form.exclude_holidays_from_leave)} onChange={e => setForm({...form,exclude_holidays_from_leave:e.target.checked})}/><span><i/></span><b>휴가 일수 계산에서 정기휴일·공휴일 제외</b></label>{form.exclude_holidays_from_leave && <><div className="weekday-picker"><b>정기 휴일</b><div>{KOREAN_WEEKDAYS.map((day,index) => <button type="button" className={(form.weekly_holiday_weekdays || []).includes(index) ? 'selected' : ''} onClick={() => toggleWeekday(index)} key={day}>{day}</button>)}</div></div><div className="holiday-date-add"><label>공휴일 직접 등록<input type="date" value={holidayDate} onChange={e => setHolidayDate(e.target.value)}/></label><button type="button" className="outline" onClick={addHoliday}>+ 날짜 추가</button></div><div className="shift-type-chips holiday-chips">{(form.public_holiday_dates || []).length ? form.public_holiday_dates.map(date => <span key={date}>{date}<button type="button" aria-label={`${date} 삭제`} onClick={() => setForm({...form,public_holiday_dates:form.public_holiday_dates.filter(value => value !== date)})}>×</button></span>) : <small>등록된 공휴일이 없습니다.</small>}</div></>}</div></section><button className="submit settings-save">계산 기준 저장</button></form>}{message && <NoticeModal message={message} tone={/못|오류/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function HolidayWorkCompensationSettings({ organizationId, onSaved }) {
  const [form, setForm] = useState({ public_holiday_work_compensation: 'none', public_holiday_work_compensation_days: 1, weekly_holiday_work_compensation: 'none', weekly_holiday_work_compensation_days: 1 }); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('');
  useEffect(() => { getOrganizationSettings(organizationId).then(data => setForm({ public_holiday_work_compensation: data?.public_holiday_work_compensation || 'none', public_holiday_work_compensation_days: Number(data?.public_holiday_work_compensation_days || 1), weekly_holiday_work_compensation: data?.weekly_holiday_work_compensation || 'none', weekly_holiday_work_compensation_days: Number(data?.weekly_holiday_work_compensation_days || 1) })).catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, [organizationId]);
  const options = [{ value: 'none', title: '보상 없음', description: '출퇴근 기록만 남깁니다.' }, { value: 'substitute_day_off', title: '대체휴무 적립', description: '직원별 대체휴무 잔여일로 적립합니다.' }, { value: 'additional_paid_leave', title: '추가 유급휴가 적립', description: '직원별 추가 유급휴가 잔여일로 적립합니다.' }];
  const policyEditor = (title, description, key, daysKey) => <div className="holiday-compensation-policy"><div><b>{title}</b><p>{description}</p></div><div className="compensation-options">{options.map(option => <button type="button" key={option.value} className={form[key] === option.value ? 'selected' : ''} onClick={() => setForm({ ...form, [key]: option.value })}><b>{option.title}</b><span>{option.description}</span></button>)}</div>{form[key] !== 'none' && <label className="compensation-days">적립 일수<span className="input-with-unit"><input type="number" min="0.5" max="3" step="0.5" value={form[daysKey]} onChange={event => setForm({ ...form, [daysKey]: event.target.value })}/><em>일 / 근무 1회</em></span></label>}</div>;
  const save = async event => { event.preventDefault(); try { await saveOrganizationSettings({ organization_id: organizationId, public_holiday_work_compensation: form.public_holiday_work_compensation, public_holiday_work_compensation_days: Number(form.public_holiday_work_compensation_days || 1), weekly_holiday_work_compensation: form.weekly_holiday_work_compensation, weekly_holiday_work_compensation_days: Number(form.weekly_holiday_work_compensation_days || 1) }); setMessage('공휴일·정기휴일 근무 보상 기준을 저장했어요.'); onSaved?.(); } catch (error) { setMessage(error.message || '저장하지 못했습니다.'); } };
  return <section className="card settings-card holiday-compensation-card">{loading ? <LoadingBar label="휴일 근무 보상 기준을 불러오는 중…"/> : <form className="settings-form" onSubmit={save}><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">☀</span><div><h2>공휴일 · 정기휴일 근무 보상</h2><p>태블릿 퇴근 기록이 완료되면 선택한 보상 일수를 자동으로 적립합니다.</p></div></div>{policyEditor('공휴일 근무', '운영 설정에 직접 등록한 공휴일에 근무한 경우 적용됩니다.', 'public_holiday_work_compensation', 'public_holiday_work_compensation_days')}{policyEditor('정기휴일 근무', '정기휴일로 지정한 요일에 근무한 경우 적용됩니다.', 'weekly_holiday_work_compensation', 'weekly_holiday_work_compensation_days')}<p className="settings-help">공휴일이 정기휴일과 겹치면 공휴일 기준을 우선 적용합니다. 법정 휴일수당·대체휴무 적용은 근로계약과 사업장 규모에 따라 다를 수 있어 운영 전 노무 검토가 필요합니다.</p></section><button className="submit settings-save">휴일 근무 보상 기준 저장</button></form>}{message && <NoticeModal message={message} tone={/못|오류/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function AttendancePayrollSettingsLegacy({ organizationId, onSaved }) {
  const [form, setForm] = useState({ attendance_rounding_minutes: 30, attendance_rounding_mode: 'ceil', month_end_auto_processing_enabled: true }); const [month, setMonth] = useState(todayKey.slice(0, 7)); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { getOrganizationSettings(organizationId).then(data => setForm({ attendance_rounding_minutes: Number(data?.attendance_rounding_minutes || 30), attendance_rounding_mode: data?.attendance_rounding_mode || 'ceil', month_end_auto_processing_enabled: data?.month_end_auto_processing_enabled !== false })).catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, [organizationId]);
  const save = async event => { event.preventDefault(); setBusy(true); try { await saveOrganizationSettings({ organization_id: organizationId, attendance_rounding_minutes: Number(form.attendance_rounding_minutes), attendance_rounding_mode: form.attendance_rounding_mode, month_end_auto_processing_enabled: Boolean(form.month_end_auto_processing_enabled) }); setMessage('출퇴근 급여 계산 기준을 저장했어요.'); onSaved?.(); } catch (error) { setMessage(error.message || '저장하지 못했습니다.'); } finally { setBusy(false); } };
  const processMonthEnd = async () => { if (!window.confirm(`${monthLabelFor(month)} 마감 처리를 실행할까요? 월차·연차 적립과 다음 달 정기휴일 일정이 생성됩니다.`)) return; setBusy(true); try { const result = await runMonthEndOperations({ organizationId, targetMonth: month }); await onSaved?.(); setMessage(`마감 완료: 월차 ${result.monthlyLeaveGranted}명 · 연차 ${result.annualLeaveGranted}명 · 다음 달 휴무 ${result.nextMonthDaysOffCreated}건을 반영했어요.`); } catch (error) { setMessage(error.message || '월말 마감 처리를 완료하지 못했습니다.'); } finally { setBusy(false); } };
  return <section className="card settings-card holiday-compensation-card">{loading ? <LoadingBar label="급여 계산 기준을 불러오는 중…"/> : <><form className="settings-form" onSubmit={save}><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">₩</span><div><h2>출퇴근 기반 급여 계산</h2><p>시급제는 실제 출퇴근 시간을 선택한 단위로 보정해 예상 급여에 반영합니다.</p></div></div><div className="settings-input-grid leave-policy-grid"><label>계산 단위<select value={form.attendance_rounding_minutes} onChange={event => setForm({ ...form, attendance_rounding_minutes: Number(event.target.value) })}>{[1,5,10,15,30,60].map(value => <option key={value} value={value}>{value}분</option>)}</select></label><label>단위 처리 방식<select value={form.attendance_rounding_mode} onChange={event => setForm({ ...form, attendance_rounding_mode: event.target.value })}><option value="ceil">올림 (예: 10분 → 30분)</option><option value="nearest">반올림</option><option value="floor">버림</option></select></label></div><p className="settings-help">예: 30분·올림 기준이면 실제 9시 10분 퇴근까지의 근무 시간이 다음 30분 단위로 반영됩니다. 근로계약·법정수당 기준은 별도 검토가 필요합니다.</p><label className="toggle-label"><input type="checkbox" checked={form.month_end_auto_processing_enabled} onChange={event => setForm({ ...form, month_end_auto_processing_enabled: event.target.checked })}/><span><i/></span><b>월말 자동 마감 처리 사용</b></label></section><button className="submit settings-save" disabled={busy}>{busy ? '저장 중…' : '급여 계산 기준 저장'}</button></form><section className="settings-section month-end-run"><div className="settings-section-head"><span className="settings-icon">◷</span><div><h2>월말 자동 반영</h2><p>선택한 달의 월차·연차를 적립하고 다음 달 토·일·공휴일 휴무 일정을 미리 생성합니다.</p></div></div><div className="month-end-actions"><label>마감 대상 월<input type="month" value={month} max={todayKey.slice(0, 7)} onChange={event => setMonth(event.target.value)}/></label><button type="button" className="outline" disabled={busy} onClick={processMonthEnd}>{busy ? '마감 처리 중…' : '월말 계산 실행'}</button></div></section></>}{message && <NoticeModal message={message} tone={/못|오류/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function AttendancePayrollSettings({ organizationId, onSaved }) {
  const [form, setForm] = useState({ attendance_rounding_minutes: 30, attendance_rounding_mode: 'ceil', payroll_deduct_break_enabled: true, payroll_rounding_enabled: true, month_end_auto_processing_enabled: true, payroll_notification_day: 25, payroll_notification_email_enabled: true, payroll_notification_kakao_enabled: false, payroll_notification_push_enabled: false }); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { getOrganizationSettings(organizationId).then(data => setForm(current => ({ ...current, ...data, attendance_rounding_minutes: Number(data?.attendance_rounding_minutes || 30), payroll_notification_day: Number(data?.payroll_notification_day || 25) }))).catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, [organizationId]);
  const save = async event => { event.preventDefault(); setBusy(true); try { await saveOrganizationSettings({ organization_id: organizationId, attendance_rounding_minutes: Number(form.attendance_rounding_minutes), attendance_rounding_mode: form.attendance_rounding_mode, payroll_deduct_break_enabled: Boolean(form.payroll_deduct_break_enabled), payroll_rounding_enabled: Boolean(form.payroll_rounding_enabled), month_end_auto_processing_enabled: Boolean(form.month_end_auto_processing_enabled), payroll_notification_day: Number(form.payroll_notification_day), payroll_notification_email_enabled: Boolean(form.payroll_notification_email_enabled), payroll_notification_kakao_enabled: Boolean(form.payroll_notification_kakao_enabled), payroll_notification_push_enabled: Boolean(form.payroll_notification_push_enabled) }); setMessage('급여 계산과 급여일 알림 설정을 저장했어요.'); onSaved?.(); } catch (error) { setMessage(error.message || '저장하지 못했습니다.'); } finally { setBusy(false); } };
  return <section className="card settings-card holiday-compensation-card">{loading ? <LoadingBar label="급여 설정을 불러오는 중…"/> : <form className="settings-form" onSubmit={save}><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">₩</span><div><h2>출퇴근 기반 급여 계산</h2><p>시급제는 실제 출퇴근 시간을 선택한 단위로 보정해 예상 급여에 반영합니다.</p></div></div><div className="settings-input-grid"><label>계산 단위<select value={form.attendance_rounding_minutes} onChange={event => setForm({ ...form, attendance_rounding_minutes: Number(event.target.value) })}>{[1,5,10,15,30,60].map(value => <option key={value} value={value}>{value}분</option>)}</select></label><label>단위 처리 방식<select value={form.attendance_rounding_mode} onChange={event => setForm({ ...form, attendance_rounding_mode: event.target.value })}><option value="ceil">올림</option><option value="nearest">반올림</option><option value="floor">버림</option></select></label></div></section><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">✉</span><div><h2>급여일 알림</h2><p>설정한 날짜에 직원별 알림 발송 대기열을 생성합니다. 이메일은 발송 환경 설정 시 자동 발송되고, 카카오·푸시는 채널 설정 후 활성화됩니다.</p></div></div><div className="settings-input-grid"><label>급여 알림일<input type="number" min="1" max="31" value={form.payroll_notification_day} onChange={event => setForm({ ...form, payroll_notification_day: event.target.value })}/></label><div className="notification-channel-options"><label className="toggle-label"><input type="checkbox" checked={form.payroll_notification_email_enabled} onChange={event => setForm({ ...form, payroll_notification_email_enabled: event.target.checked })}/><span><i/></span><b>이메일</b></label><label className="toggle-label"><input type="checkbox" checked={form.payroll_notification_kakao_enabled} onChange={event => setForm({ ...form, payroll_notification_kakao_enabled: event.target.checked })}/><span><i/></span><b>카카오 알림톡</b></label><label className="toggle-label"><input type="checkbox" checked={form.payroll_notification_push_enabled} onChange={event => setForm({ ...form, payroll_notification_push_enabled: event.target.checked })}/><span><i/></span><b>푸시 알림</b></label></div></div><p className="settings-help">급여일이 없는 달(예: 31일)은 해당 월의 마지막 날에 발송하도록 다음 단계에서 확장할 수 있습니다. 현재는 매일 오전 10시(KST) 발송 대기열을 검사합니다.</p></section><button className="submit settings-save" disabled={busy}>{busy ? '저장 중…' : '급여 설정 저장'}</button></form>}{message && <NoticeModal message={message} tone={/못|오류/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function OperationalAlertPanel({ organizationId, onNavigate }) {
  const [alerts, setAlerts] = useState([]); const [loading, setLoading] = useState(true);
  const refresh = () => { if (!organizationId) return; setLoading(true); loadOperationalAlerts(organizationId).then(setAlerts).catch(() => setAlerts([])).finally(() => setLoading(false)); };
  useEffect(() => { refresh(); }, [organizationId]);
  const markRead = async alert => { try { await markOperationalAlertRead(alert.id); setAlerts(items => items.map(item => item.id === alert.id ? { ...item, status: 'read', read_at: new Date().toISOString() } : item)); } catch (_) {} };
  const pending = alerts.filter(alert => ['queued', 'sent'].includes(alert.status));
  return <section className="card full-card"><div className="card-title"><div><h2>미출근 알림</h2><p>스케줄 시작 후 출근 기록이 없는 직원을 알려드려요.</p></div><button onClick={() => onNavigate('attendance')}>출퇴근 관리</button></div>{loading ? <LoadingBar label="미출근 알림을 확인하는 중…"/> : pending.length ? pending.slice(0, 5).map(alert => <div className="salary-row" key={alert.id}><span className="grow"><b>{alert.timefit_user_staff?.account?.display_name || alert.timefit_user_staff?.display_name || '직원'}님 미출근</b><small>{alert.message}<br/>{new Date(alert.scheduled_for).toLocaleString('ko-KR')} 기준</small></span><Chip type="orange">확인 필요</Chip><button className="outline" onClick={() => markRead(alert)}>확인 완료</button></div>) : <div className="empty-schedule"><b>현재 확인할 미출근 알림이 없어요.</b><span>운영 설정의 지연 시간 이후 자동으로 감지됩니다.</span></div>}</section>;
}

function ManagerGroupTabs({ groupId, onChange, groups = managerMenuGroups }) {
  return <nav className="manager-menu-groups" aria-label="관리자 대메뉴">{groups.map(group => <button key={group.id} className={groupId === group.id ? 'active' : ''} onClick={() => onChange(group)}>{group.label}</button>)}</nav>;
}

const CATEGORY_COLORS = ['#3182F6', '#00A86B', '#8B5CF6', '#F97316', '#E65F5C', '#0EA5E9'];

function StaffCategorySettings({ organizationId, onSaved }) {
  const [categories, setCategories] = useState([]); const [name, setName] = useState(''); const [color, setColor] = useState(CATEGORY_COLORS[0]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const refresh = () => { if (!organizationId) return; loadStaffCategories(organizationId).then(setCategories).catch(error => setMessage(error.message || '직원 구분을 불러오지 못했습니다.')); };
  useEffect(() => { refresh(); }, [organizationId]);
  const add = async event => { event.preventDefault(); if (!name.trim()) return; setBusy(true); try { await saveStaffCategory({ organizationId, name, color, sortOrder: categories.length + 1 }); setName(''); await refresh(); await onSaved?.(); setMessage('직원 구분을 추가했어요.'); } catch (error) { setMessage(error.message?.includes('duplicate') ? '같은 이름의 구분이 이미 있어요.' : error.message || '직원 구분을 저장하지 못했습니다.'); } finally { setBusy(false); } };
  const remove = async category => { if (category.name === '미분류') return setMessage('미분류 구분은 삭제할 수 없어요.'); if (!window.confirm(`“${category.name}” 구분을 삭제할까요? 해당 직원은 미분류로 표시됩니다.`)) return; setBusy(true); try { await deleteStaffCategory(category.id); await refresh(); await onSaved?.(); setMessage('직원 구분을 삭제했어요.'); } catch (error) { setMessage(error.message || '사용 중인 직원 구분을 삭제하지 못했습니다.'); } finally { setBusy(false); } };
  return <section className="card settings-card staff-category-settings"><section className="settings-section"><div className="settings-section-head"><span className="settings-icon">◉</span><div><h2>직원 구분 관리</h2><p>예: 홀, 주방, 바. 등록한 구분은 직원 등록·직원 관리·스케줄 인원 집계에 같은 색으로 표시됩니다.</p></div></div><div className="category-preview-row">{categories.map(category => <span className="staff-category-chip" key={category.id} style={{ '--category-color': category.color }}><i/>{category.name}<button type="button" aria-label={`${category.name} 삭제`} disabled={busy || category.name === '미분류'} onClick={() => remove(category)}>×</button></span>)}</div><form className="category-create-form" onSubmit={add}><label>새 구분<input value={name} onChange={event => setName(event.target.value)} maxLength="30" placeholder="예: 주방" required/></label><div className="category-color-picker">{CATEGORY_COLORS.map(value => <button key={value} type="button" aria-label={`${value} 색상`} className={color === value ? 'selected' : ''} style={{ background: value }} onClick={() => setColor(value)}/>)}</div><button className="outline" disabled={busy}>{busy ? '추가 중…' : '구분 추가'}</button></form><p className="settings-help">구분을 삭제하면 해당 직원은 “미분류”로 안전하게 이동합니다.</p></section>{message && <NoticeModal message={message} tone={/못|없어요/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function StaffCategorySelect({ organizationId, name = 'categoryId', disabled = false, defaultValue = '' }) {
  const [categories, setCategories] = useState([]);
  const [value, setValue] = useState(defaultValue || '');
  // The options are loaded asynchronously. Keep the selected id controlled so
  // an employee's saved category is restored after those options arrive.
  useEffect(() => { setValue(defaultValue || ''); }, [defaultValue, organizationId]);
  useEffect(() => { if (organizationId) loadStaffCategories(organizationId).then(setCategories).catch(() => setCategories([])); }, [organizationId]);
  return <select name={name} value={value} onChange={event => setValue(event.target.value)} disabled={disabled}><option value="">미분류</option>{categories.filter(category => category.name !== '미분류').map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>;
}

function ScheduleCategorySummary({ employees, scheduleByDate, onSelect, onEdit, canManage = false }) {
  const [selectedDate, setSelectedDate] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(todayKey.slice(0, 7));
  const categoryRows = useMemo(() => {
    const totals = new Map();
    Object.entries(scheduleByDate || {}).forEach(([date, entries]) => {
      if (!date.startsWith(calendarMonth)) return;
      entries.forEach(([, time, , , staffId, categoryName, categoryColor]) => {
        if (time === '휴무' || time === '연차') return;
        const staff = employees.find(item => item.id === staffId);
        const name = categoryName || staff?.team || '미분류'; const color = categoryColor || staff?.categoryColor || '#8B95A1';
        const current = totals.get(name) || { name, color, count: 0, keys: new Set() }; const key = `${date}:${staffId || name}`;
        if (!current.keys.has(key)) { current.keys.add(key); current.count += 1; } totals.set(name, current);
      });
    });
    return [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [employees, scheduleByDate, calendarMonth]);
  const categoryCountsForDay = date => {
    const totals = new Map();
    (scheduleByDate[date] || []).forEach(([, time, , , staffId, categoryName, categoryColor]) => {
      if (time === '휴무' || time === '연차') return;
      const staff = employees.find(item => item.id === staffId); const name = categoryName || staff?.team || '미분류'; const color = categoryColor || staff?.categoryColor || '#8B95A1';
      const current = totals.get(name) || { name, color, count: 0 }; current.count += 1; totals.set(name, current);
    });
    return [...totals.values()];
  };
  const staffForDay = date => schedulePeople(scheduleByDate[date] || [], employees);
  const cells = monthDaysFor(calendarMonth);
  const entryIsOff = entry => entry?.[1] === '휴무' || entry?.[1] === '연차';
  const selectedEntries = selectedDate ? [...(scheduleByDate[selectedDate] || [])].sort((a, b) => Number(entryIsOff(a)) - Number(entryIsOff(b))) : [];
  useEffect(() => {
    const heading = document.querySelector('.schedule-category-heading');
    if (!heading) return;
    const previous = heading.querySelector('.schedule-month-picker');
    if (previous) previous.remove();
    const picker = document.createElement('div');
    picker.className = 'schedule-month-picker';
    const move = offset => {
      const [year, month] = calendarMonth.split('-').map(Number);
      const next = new Date(year, month - 1 + offset, 1, 12);
      setCalendarMonth(formatDateKey(next).slice(0, 7));
      setSelectedDate(null);
    };
    const prev = document.createElement('button'); prev.type = 'button'; prev.setAttribute('aria-label', '이전 달'); prev.textContent = '‹'; prev.onclick = () => move(-1);
    const input = document.createElement('input'); input.type = 'month'; input.value = calendarMonth; input.setAttribute('aria-label', '스케줄 연월 선택'); input.onchange = event => { if (event.target.value) { setCalendarMonth(event.target.value); setSelectedDate(null); } };
    const next = document.createElement('button'); next.type = 'button'; next.setAttribute('aria-label', '다음 달'); next.textContent = '›'; next.onclick = () => move(1);
    const current = document.createElement('button'); current.type = 'button'; current.className = 'today-button'; current.textContent = '이번 달'; current.disabled = calendarMonth === todayKey.slice(0, 7); current.onclick = () => { setCalendarMonth(todayKey.slice(0, 7)); setSelectedDate(null); };
    picker.append(prev, input, next, current);
    heading.appendChild(picker);
    return () => picker.remove();
  }, [calendarMonth]);
  return <><section className="schedule-category-overview" aria-label="월간 근무자 배정 현황"><div className="schedule-category-heading"><div><b>월간 근무자 현황</b><span>날짜별 소속과 근무자 이름을 확인하고 일정을 수정·취소할 수 있습니다.</span></div><div className="schedule-category-totals">{categoryRows.length ? <small>이번 달 총 {categoryRows.reduce((sum, item) => sum + item.count, 0)}건 배정</small> : <small>등록된 근무 일정이 없어요.</small>}</div></div><div className="category-calendar-mini">{KOREAN_WEEKDAYS.map(day => <b key={day}>{day}</b>)}{cells.map(cell => { const staff = cell.inMonth ? staffForDay(cell.id) : []; return cell.inMonth ? <button type="button" className={cell.id === todayKey ? 'today' : ''} key={cell.id} onClick={() => setSelectedDate(cell.id)} aria-label={`${formatKoreanDate(cell.id)} 일정 상세 보기`}><strong>{cell.day}</strong>{staff.slice(0, 3).map(person => <span className="calendar-staff-name" key={person.id}><em>{person.team || '미분류'}</em>{person.name}</span>)}{staff.length > 3 && <small>외 {staff.length - 3}명</small>}{!staff.length && <small>일정 보기</small>}</button> : <div className="outside" key={cell.id}><strong>{cell.day}</strong></div>; })}</div></section>{selectedDate && <Modal title={`${formatKoreanDate(selectedDate)} 근무 일정`} onClose={() => setSelectedDate(null)}><p className="modal-text">{canManage ? '등록된 일정을 수정하거나 취소할 수 있어요.' : '등록된 근무자와 시간을 확인할 수 있어요.'}</p><div className="schedule-day-detail-list">{selectedEntries.length ? selectedEntries.map(([name, time, shiftName, id, staffId, categoryName, categoryColor, breakMinutes], index) => { const employee = employees.find(item => item.id === staffId || item.name === name); const category = categoryName || employee?.team || '미분류'; return <div className="schedule-day-detail-row" key={`${staffId || name}-${index}`}><button type="button" className="schedule-person-link" onClick={() => { setSelectedDate(null); onSelect?.(employee); }}><Avatar name={name} color={employee?.color || 'blue'}/><span className="grow"><b>{name}</b><small><i style={{ background: categoryColor || employee?.categoryColor || '#8B95A1' }}/>{category} · {shiftName || '일반 근무'}</small></span><strong>{time}</strong></button>{canManage && <button type="button" className="outline" onClick={() => { setSelectedDate(null); onEdit?.({ id, staffId: staffId || employee?.id, name, time, label: shiftName, date: selectedDate, breakMinutes: Number(breakMinutes) || 0 }); }}>수정·취소</button>}</div>; }) : <div className="empty-schedule"><b>등록된 근무가 없어요.</b><span>이 날짜에는 배정된 근무 일정이 없습니다.</span></div>}</div></Modal>}</>;
}

function Dashboard({ employees, leaveRequests, schedules, setModal, onOpenLeave, onSelect, onNavigate, organizationId, canViewPayroll = false, canManageEmployees = false }) {
  const working = employees.filter(x => x.state === '근무 중').length;
  const pendingLeaveRequests = leaveRequests.filter(item => item.status === '승인 대기');
  const pendingLeaves = pendingLeaveRequests.slice(0, 3);
  const todayScheduled = (schedules[todayKey] || []).filter(([, time]) => time !== '휴무' && time !== '연차');
  const todayScheduledStaff = employees.filter(employee => todayScheduled.some(([name, , , , staffId]) => staffId ? staffId === employee.id : name === employee.name));
  const scheduledNoShows = todayScheduledStaff.filter(employee => employee.state === '미출근');
  const needsAttention = scheduledNoShows.length + pendingLeaveRequests.length;
  const estimatedPayroll = employees.reduce((sum, item) => sum + estimatedPayrollFor(item), 0);
  const weekDays = weekDaysFor(todayKey);
  const weeklySummary = weekDays.map(day => {
    const shifts = schedules[day.id] || [];
    const workingCount = shifts.filter(([, time]) => time !== '휴무' && time !== '연차').length;
    const leaveCount = leaveRequests.filter(request => request.status !== '반려' && request.startsAt <= day.id && (request.endsAt || request.startsAt) >= day.id).length;
    const scheduledStaff = shifts.filter(([, time]) => time !== '휴무' && time !== '연차').map(([name, , , , staffId]) => employees.find(employee => staffId ? employee.id === staffId : employee.name === name)).filter(Boolean);
    return { ...day, workingCount, leaveCount, scheduledStaff, shifts };
  });
  return <>
    <div className="hero"><div><p className="date-label">{today}</p><h1>오늘, 매장은 잘 돌아가고 있나요?</h1><p>출퇴근부터 승인 요청까지 필요한 정보를 한 번에 확인하세요.</p></div>{canManageEmployees && <button className="cta" onClick={() => setModal('employee')}>직원 등록하기 <span>→</span></button>}</div>
    <section className="summary-grid">
      <article><p>오늘 출근</p><strong>{employees.filter(item => item.time !== '-').length}<small>명</small></strong><span>전체 {employees.length}명 중</span></article>
      <article><p>현재 근무 중</p><strong>{working}<small>명</small></strong><span className="up">실제 출퇴근 기록 기준</span></article>
      <article><p>확인 필요</p><strong className="warn">{needsAttention}<small>건</small></strong><span>오늘 출근 확인 {scheduledNoShows.length}명 · 휴가 승인 {pendingLeaveRequests.length}건</span></article>
      {canViewPayroll && <article><p>이번 달 인건비</p><strong>{formatMoney(estimatedPayroll)}</strong><span>등록 급여·실근무 기준 예상</span></article>}
    </section>
    <div className="dashboard-layout">
      <section className="card live-card"><div className="card-title"><div><h2>실시간 출퇴근</h2><p>오늘 등록된 근무 일정 기준</p></div><button onClick={() => onNavigate('attendance')}>전체 보기</button></div>
        <div className="attendance-list">{todayScheduledStaff.length ? todayScheduledStaff.slice(0, 4).map(item => <div className="attendance-row clickable-row" key={item.id} onClick={() => onSelect(item)}><Avatar name={item.name} color={item.color}/><div className="grow"><b>{item.name}</b><span>{item.team} · {item.role}</span></div><div className="time"><Chip type={item.state === '근무 중' ? 'green' : item.state === '지각' ? 'orange' : 'gray'}>{item.state}</Chip><b>{item.time}</b></div></div>) : <p className="empty-state">오늘 등록된 근무 일정이 없어요.</p>}</div>
      </section>
      <section className="card approval-card"><div className="card-title"><div><h2>승인할 일이 있어요</h2><p>실제 제출된 휴가 요청만 표시합니다.</p></div><span className="count">{pendingLeaveRequests.length}</span></div>
        {pendingLeaves.length ? pendingLeaves.map((request, index) => <button className="approval" key={request.id} onClick={() => onOpenLeave(request)}><Avatar name={request.employee} color={['purple','orange','mint'][index % 3]}/><span><b>{request.employee}님의 {request.type} 신청</b><small>{request.date} · {request.amount}</small></span><i>›</i></button>) : <p className="empty-state">승인할 휴가 요청이 없어요.</p>}
      </section>
    </div>
    <OperationalAlertPanel organizationId={organizationId} onNavigate={onNavigate}/>
    <section className="card weekly"><div className="card-title"><div><h2>이번 주 스케줄</h2><p>{weekDays[0].day}일 ~ {weekDays[6].day}일 · 근무자 이름으로 표시</p></div><button onClick={() => onNavigate('schedule')}>스케줄 관리</button></div><div className="week">{weeklySummary.map(day => <div className={day.id === todayKey ? 'selected-day' : ''} key={day.id}><b>{day.weekday} <small>{day.day}</small></b>{day.scheduledStaff.length ? <div className="week-staff-names">{day.scheduledStaff.map((employee, index) => { const row = day.shifts.find(item => item[4] ? item[4] === employee.id : item[0] === employee.name); return <button type="button" key={`${employee.id}-${index}`} onClick={() => setModal({ type: 'scheduleEdit', schedule: { id: row?.[3], staffId: row?.[4] || employee.id, name: employee.name, time: row?.[1], label: row?.[2], date: day.id, breakMinutes: Number(row?.[7]) || 0 } })}>{employee.name}<small>수정·취소</small></button>; })}</div> : <span>등록된 근무 없음</span>}{day.leaveCount ? <small className="week-leave-count">휴가 {day.leaveCount}건</small> : null}</div>)}</div></section>
  </>;
}

const attendanceInputValue = value => value ? new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value)).replace(' ', 'T') : '';

function AttendanceCorrectionModal({ employees, initialDate, organizationId, onClose, onSaved }) {
  const [staffId, setStaffId] = useState(employees[0]?.id || ''); const [workDate, setWorkDate] = useState(initialDate); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const employee = employees.find(item => item.id === staffId); const attendance = (employee?.attendanceHistory || []).find(item => item.work_date === workDate);
  const [checkedIn, setCheckedIn] = useState(''); const [checkedOut, setCheckedOut] = useState('');
  useEffect(() => { setCheckedIn(attendanceInputValue(attendance?.checked_in_at)); setCheckedOut(attendanceInputValue(attendance?.checked_out_at)); }, [staffId, workDate, attendance?.id]);
  const save = async event => { event.preventDefault(); if (!checkedIn) return setMessage('출근 시간을 입력해 주세요.'); if (checkedOut && checkedOut < checkedIn) return setMessage('퇴근 시간은 출근 시간보다 빠를 수 없습니다.'); setBusy(true); try { await correctAttendanceRecord({ organizationId, staffId, workDate, checkedInAt:`${checkedIn}:00+09:00`, checkedOutAt:checkedOut ? `${checkedOut}:00+09:00` : null, reason:new FormData(event.currentTarget).get('reason') }); await onSaved(); onClose(); } catch (error) { setMessage(error.message || '출퇴근 기록을 수정하지 못했습니다.'); } finally { setBusy(false); } };
  return <Modal title="출퇴근 기록 수정" onClose={() => { if (!busy) onClose(); }}><form onSubmit={save}><p className="modal-text">최고관리자가 잘못 기록되거나 누락된 출퇴근 시간을 정정합니다. 수정 내역은 감사 기록에 보관됩니다.</p><label>직원<select value={staffId} onChange={event=>setStaffId(event.target.value)} required disabled={busy}>{employees.map(item=><option key={item.id} value={item.id}>{item.name} · {item.team}</option>)}</select></label><label>근무일<input type="date" value={workDate} onChange={event=>setWorkDate(event.target.value)} required disabled={busy}/></label><div className="form-row"><label>출근 시간<input type="datetime-local" value={checkedIn} onChange={event=>setCheckedIn(event.target.value)} required disabled={busy}/></label><label>퇴근 시간 <small>(근무 중이면 비움)</small><input type="datetime-local" value={checkedOut} onChange={event=>setCheckedOut(event.target.value)} disabled={busy}/></label></div><label>수정 사유<input name="reason" minLength="2" maxLength="200" placeholder="예: 직원이 퇴근 시간을 잘못 기록함" required disabled={busy}/></label>{message && <p className="form-error">{message}</p>}<button className="submit" disabled={busy}>{busy?'저장 중…':'수정 내용 저장'}</button></form></Modal>;
}

function Attendance({ employees, checkedIn, setCheckedIn, onSelect, canRecordOwnAttendance = false, canCorrectAttendance = false, organizationId, onRefresh }) {
  const currentDateKey = useCurrentKoreanDateKey();
  const [selectedDate, setSelectedDate] = useState(currentDateKey);
  const [filter, setFilter] = useState('전체');
  const [correcting, setCorrecting] = useState(false);
  useEffect(() => { setSelectedDate(current => current || currentDateKey); }, [currentDateKey]);

  const moveDate = offset => {
    const next = dateFromKey(selectedDate); next.setDate(next.getDate() + offset);
    setSelectedDate(formatDateKey(next));
  };
  const rows = useMemo(() => employees.map(employee => {
    const attendance = (employee.attendanceHistory || []).find(item => item.work_date === selectedDate);
    const schedule = (employee.scheduleHistory || []).find(item => item.work_date === selectedDate && item.approval_status !== 'rejected');
    const isFuture = selectedDate > currentDateKey;
    const isDayOff = Boolean(schedule?.is_day_off);
    const scheduled = schedule && !isDayOff && schedule.starts_at && schedule.ends_at;
    const lateMinutes = scheduled && attendance?.checked_in_at
      ? Math.max(0, attendanceMinuteOnWorkDate(attendance.checked_in_at, selectedDate) - clockMinutes(schedule.starts_at))
      : 0;
    let status = '일정 없음';
    if (isDayOff) status = '휴무';
    else if (attendance?.checked_out_at) status = lateMinutes ? '지각' : '퇴근 완료';
    else if (attendance?.checked_in_at) status = lateMinutes ? '지각' : '근무 중';
    else if (scheduled) status = isFuture ? '예정' : '미출근';
    return {
      employee, attendance, schedule, lateMinutes, status,
      planned: isDayOff ? '휴무' : scheduled ? `${schedule.starts_at.slice(0, 5)}–${schedule.ends_at.slice(0, 5)}` : '-',
      worked: attendance?.checked_out_at ? formatHours(attendanceMinutes(attendance)) : attendance?.checked_in_at ? '근무 중' : '-',
    };
  }), [employees, selectedDate, currentDateKey]);
  const filteredRows = rows.filter(row => filter === '전체' || row.status === filter);
  const count = status => rows.filter(row => row.status === status).length;
  const statusType = status => status === '근무 중' || status === '퇴근 완료' ? 'green' : status === '지각' ? 'orange' : 'gray';

  return <>
    <div className="page-title attendance-page-title"><div><p>{formatKoreanDate(selectedDate)} 기준</p><h1>출퇴근 관리</h1><span>스케줄과 실제 출퇴근 기록을 날짜별로 비교합니다.</span></div><div className="page-title-actions">{canCorrectAttendance && <button className="outline" onClick={()=>setCorrecting(true)}>출퇴근 기록 수정</button>}{canRecordOwnAttendance && <button className={checkedIn ? 'checkin complete' : 'checkin'} onClick={() => setCheckedIn(!checkedIn)}>{checkedIn ? '✓ 출근 완료 · 퇴근하기' : '◷ 내 출근 기록하기'}</button>}</div></div>
    <section className="attendance-kpis" aria-label="선택 날짜 출퇴근 요약">
      <article><span>출근 기록</span><strong>{rows.filter(row => row.attendance?.checked_in_at).length}<small>명</small></strong></article>
      <article><span>퇴근 완료</span><strong>{count('퇴근 완료') + rows.filter(row => row.status === '지각' && row.attendance?.checked_out_at).length}<small>명</small></strong></article>
      <article className="late"><span>지각</span><strong>{count('지각')}<small>명</small></strong></article>
      <article className="missing"><span>미출근</span><strong>{count('미출근')}<small>명</small></strong></article>
    </section>
    <section className="card full-card attendance-management-card">
      <div className="attendance-date-tools"><button type="button" aria-label="이전 날짜" onClick={() => moveDate(-1)}>‹</button><label><span>조회 날짜</span><input type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value || currentDateKey)}/></label><button type="button" aria-label="다음 날짜" onClick={() => moveDate(1)}>›</button><button type="button" className="attendance-today" disabled={selectedDate === currentDateKey} onClick={() => setSelectedDate(currentDateKey)}>오늘</button></div>
      <div className="tabs attendance-tabs">{['전체','근무 중','퇴근 완료','지각','미출근','예정','휴무'].map(value => <button className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)} key={value}>{value}<b>{value === '전체' ? rows.length : count(value)}</b></button>)}</div>
      <div className="attendance-table-wrap"><table className="attendance-status-table"><thead><tr><th>직원</th><th>구분</th><th>예정 근무</th><th>출근</th><th>퇴근</th><th>상태</th><th>지각</th><th>실제 근무</th><th><span className="sr-only">관리</span></th></tr></thead><tbody>{filteredRows.map(({ employee, attendance, planned, status, lateMinutes, worked }) => <tr key={employee.id} onClick={() => onSelect(employee)}><td><span className="attendance-person"><Avatar name={employee.name} color={employee.color}/><b>{employee.name}<small>{employee.role}</small></b></span></td><td><span className="attendance-team" style={{ '--team-color': employee.categoryColor }}>{employee.team}</span></td><td>{planned}</td><td className="attendance-time-value">{formatAttendanceTime(attendance?.checked_in_at)}</td><td className="attendance-time-value">{formatAttendanceTime(attendance?.checked_out_at)}</td><td><Chip type={statusType(status)}>{status}</Chip></td><td className={lateMinutes ? 'attendance-late-value' : ''}>{lateMinutes ? `${lateMinutes}분` : '-'}</td><td>{worked}</td><td><button type="button" className="outline" onClick={event => { event.stopPropagation(); onSelect(employee); }}>상세</button></td></tr>)}</tbody></table>{!filteredRows.length && <div className="attendance-empty">선택한 상태의 직원이 없습니다.</div>}</div>
    </section>
    {correcting && <AttendanceCorrectionModal employees={employees} initialDate={selectedDate} organizationId={organizationId} onClose={()=>setCorrecting(false)} onSaved={onRefresh}/>}
  </>;
}

const MONTHLY_SHIFT_TEMPLATES = [
  { id: 'full', label: '풀타임', startsAt: '09:30', endsAt: '21:30', breakMinutes: 120, breakPaid: false, color: '#16a66a' },
  { id: 'morning', label: '오전 근무', startsAt: '09:30', endsAt: '15:00', breakMinutes: 0, breakPaid: false, color: '#3182f6' },
  { id: 'afternoon', label: '오후 근무', startsAt: '17:00', endsAt: '21:30', breakMinutes: 0, breakPaid: false, color: '#805ad5' },
  { id: 'half', label: '오전반차', startsAt: '17:00', endsAt: '21:30', breakMinutes: 0, breakPaid: false, color: '#f59e0b' },
  { id: 'off', label: '휴무', startsAt: '', endsAt: '', breakMinutes: 0, breakPaid: false, color: '#8b95a1' },
];
const SCHEDULE_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`);

function MonthlyScheduleEditor({ employees, scheduleByDate, leaveRequests = [], organizationId, onSave, onClose, requiresApproval = false }) {
  const shiftColors = useShiftColors(organizationId);
  const [monthKey, setMonthKey] = useState(todayKey.slice(0, 7));
  const [team, setTeam] = useState('전체');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [template, setTemplate] = useState(MONTHLY_SHIFT_TEMPLATES[0]);
  const [detailShiftName, setDetailShiftName] = useState(MONTHLY_SHIFT_TEMPLATES[0].label);
  const [detailStartsAt, setDetailStartsAt] = useState(MONTHLY_SHIFT_TEMPLATES[0].startsAt);
  const [detailEndsAt, setDetailEndsAt] = useState(MONTHLY_SHIFT_TEMPLATES[0].endsAt);
  const [detailBreakMinutes, setDetailBreakMinutes] = useState(MONTHLY_SHIFT_TEMPLATES[0].breakMinutes);
  const [detailBreakPaid, setDetailBreakPaid] = useState(false);
  const [registeredShiftTypes, setRegisteredShiftTypes] = useState(DEFAULT_SHIFT_TYPES);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showPattern, setShowPattern] = useState(false);
  const [patternDays, setPatternDays] = useState([1, 2, 3, 4, 5]);
  const [mobileWeek, setMobileWeek] = useState(0);
  const [calendarScale, setCalendarScale] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}monthly-calendar-scale`);
    return ['compact', 'default', 'large'].includes(saved) ? saved : 'large';
  });
  const [calendarFocus, setCalendarFocus] = useState(false);
  const monthlyGridRef = useRef(null);
  const [staffingNeeds, setStaffingNeeds] = useState(() => { try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}schedule-staffing-needs`) || '{}'); } catch (_) { return {}; } });
  useEffect(() => {
    if (!organizationId || !supabase) return;
    getOrganizationSettings(organizationId).then(settings => {
      const nextTypes = settings?.shift_types?.length ? settings.shift_types : DEFAULT_SHIFT_TYPES;
      setRegisteredShiftTypes(nextTypes);
      setDetailShiftName(current => nextTypes.includes(current) ? current : nextTypes[0]);
    }).catch(() => setRegisteredShiftTypes(DEFAULT_SHIFT_TYPES));
  }, [organizationId]);
  const daysInMonth = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`);
  const teams = ['전체', ...new Set(employees.map(employee => employee.team || '미분류'))];
  const visibleEmployees = employees.filter(employee => (team === '전체' || employee.team === team) && (!query.trim() || `${employee.name} ${employee.role} ${employee.team}`.toLowerCase().includes(query.trim().toLowerCase())));
  const existingFor = (employee, date) => (scheduleByDate[date] || []).find(row => (row[4] && row[4] === employee.id) || (!row[4] && row[0] === employee.name));
  const keyFor = (employeeId, date) => `${employeeId}:${date}`;
  const rowAsTemplate = row => row ? row[1] === '휴무' ? { ...MONTHLY_SHIFT_TEMPLATES.at(-1), color: shiftColorFor('휴무', shiftColors) } : { id: 'copied', label: row[2] || '근무', startsAt: String(row[1] || '').slice(0, 5), endsAt: String(row[1] || '').slice(-5), breakMinutes: Number(row[7]) || 0, breakPaid: Boolean(row[10]), color: shiftColorFor(row[2], shiftColors) } : null;
  const effectiveFor = (employee, date) => drafts[keyFor(employee.id, date)] || rowAsTemplate(existingFor(employee, date));
  useEffect(() => { const stop = () => setDragging(false); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); }; }, []);
  const toggle = (employeeId, date, event) => {
    const key = keyFor(employeeId, date);
    if (event.shiftKey && selected.length) {
      const anchor = selected.at(-1); const [anchorStaff, anchorDate] = anchor.split(':');
      if (anchorStaff === employeeId) {
        const start = Math.min(dates.indexOf(anchorDate), dates.indexOf(date)); const end = Math.max(dates.indexOf(anchorDate), dates.indexOf(date));
        setSelected(current => [...new Set([...current, ...dates.slice(start, end + 1).map(value => keyFor(employeeId, value))])]); return;
      }
    }
    setSelected(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]);
  };
  const selectEmployee = employeeId => {
    const keys = dates.map(date => keyFor(employeeId, date)); const allSelected = keys.every(key => selected.includes(key));
    setSelected(current => allSelected ? current.filter(key => !keys.includes(key)) : [...new Set([...current, ...keys])]);
  };
  const dragSelect = (employeeId, date) => { if (!dragging) return; const key = keyFor(employeeId, date); setSelected(current => current.includes(key) ? current : [...current, key]); };
  const applyTemplate = () => {
    if (!selected.length) return setMessage('근무를 적용할 직원과 날짜 칸을 먼저 선택해 주세요.');
    setDrafts(current => Object.fromEntries([...Object.entries(current), ...selected.map(key => [key, { ...template }])]));
    setMessage(`${selected.length}개 칸에 ${template.label}을 임시 적용했어요.`);
  };
  const chooseTemplate = value => {
    setTemplate(value);
    setDetailShiftName(value.label);
    setDetailStartsAt(value.startsAt);
    setDetailEndsAt(value.endsAt);
    setDetailBreakMinutes(value.breakMinutes);
    setDetailBreakPaid(Boolean(value.breakPaid));
  };
  const applyDetails = () => {
    if (!selected.length) return setMessage('상세 근무를 적용할 직원과 날짜 칸을 먼저 선택해 주세요.');
    const isOff = detailShiftName.includes('휴무');
    if (!isOff && (!detailStartsAt || !detailEndsAt)) return setMessage('근무 시작 시간과 종료 시간을 입력해 주세요.');
    if (!isOff && detailStartsAt === detailEndsAt) return setMessage('시작 시간과 종료 시간은 다르게 입력해 주세요.');
    const value = { id: 'custom', label: detailShiftName.trim() || '일반 근무', startsAt: isOff ? '' : detailStartsAt, endsAt: isOff ? '' : detailEndsAt, breakMinutes: isOff ? 0 : Math.max(0, Number(detailBreakMinutes) || 0), breakPaid: isOff ? false : detailBreakPaid, color: shiftColorFor(detailShiftName, shiftColors) };
    setDrafts(current => Object.fromEntries([...Object.entries(current), ...selected.map(key => [key, value])]));
    setMessage(`${selected.length}개 칸에 ${value.label} 상세 설정을 적용했어요.`);
  };
  const draftRows = Object.entries(drafts);
  const existingOverwriteCount = draftRows.filter(([key]) => { const [staffId, date] = key.split(':'); const employee = employees.find(item => String(item.id) === staffId); return employee && existingFor(employee, date); }).length;
  const selectedExistingSchedules = selected.map(key => { const [staffId, date] = key.split(':'); const employee = employees.find(item => String(item.id) === staffId); const row = employee && existingFor(employee, date); return row?.[3] ? { id: row[3], name: employee.name, date } : null; }).filter(Boolean);
  const selectedDraftKeys = selected.filter(key => drafts[key]);
  const undoSelectedDrafts = () => {
    if (!selectedDraftKeys.length) return setMessage('되돌릴 임시 변경 칸을 선택해 주세요.');
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !selectedDraftKeys.includes(key))));
    setMessage(`선택한 ${selectedDraftKeys.length}개 칸의 임시 변경을 되돌렸어요.`);
  };
  const resetAllDrafts = () => {
    if (!draftRows.length || !window.confirm(`아직 저장하지 않은 변경 ${draftRows.length}건을 모두 되돌릴까요?`)) return;
    setDrafts({}); setSelected([]); setMessage('저장 전 변경을 모두 되돌렸어요.');
  };
  const closeEditor = () => {
    if (draftRows.length && !window.confirm(`저장하지 않은 변경 ${draftRows.length}건이 있어요. 저장하지 않고 닫을까요?`)) return;
    onClose();
  };
  const cancelSelectedSchedules = async () => {
    if (!selectedExistingSchedules.length) return setMessage('취소할 기존 스케줄 칸을 선택해 주세요.');
    if (!window.confirm(`선택한 기존 근무 일정 ${selectedExistingSchedules.length}건을 취소할까요?`)) return;
    setBusy(true);
    try { await onSave({ cancellations: selectedExistingSchedules }); onClose(); }
    catch (error) { setMessage(error.message || '선택한 스케줄을 취소하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!draftRows.length) return setMessage('저장할 변경 사항이 없습니다.');
    const invalid = draftRows.find(([, value]) => value.startsAt && value.endsAt && value.startsAt === value.endsAt);
    if (invalid) return setMessage('시작 시간과 종료 시간이 같은 근무가 있습니다.');
    setBusy(true);
    try {
      const groups = new Map();
      draftRows.forEach(([key, value]) => { const [staffId, date] = key.split(':'); const groupKey = [value.label, value.startsAt, value.endsAt, value.breakMinutes, Boolean(value.breakPaid)].join('|'); const group = groups.get(groupKey) || { ...value, staffIds: new Set(), datesByStaff: new Map() }; group.staffIds.add(staffId); group.datesByStaff.set(staffId, [...(group.datesByStaff.get(staffId) || []), date]); groups.set(groupKey, group); });
      const changes = [...groups.values()].flatMap(group => [...group.datesByStaff].map(([staffId, workDates]) => ({ staffIds: [employees.find(item => String(item.id) === staffId)?.id || staffId], dates: workDates, startsAt: group.startsAt, endsAt: group.endsAt, shiftName: group.label, breakMinutes: group.breakMinutes, breakPaid: Boolean(group.breakPaid) })));
      await onSave(changes); onClose();
    } catch (error) { setMessage(error.message || '월간 스케줄을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const applyPattern = () => {
    const staffIds = [...new Set(selected.map(key => key.split(':')[0]))];
    if (!staffIds.length) return setMessage('반복할 직원의 칸이나 직원 행을 먼저 선택해 주세요.');
    const keys = staffIds.flatMap(staffId => dates.filter(date => patternDays.includes(dateFromKey(date).getDay())).map(date => keyFor(staffId, date)));
    setSelected(keys); setDrafts(current => Object.fromEntries([...Object.entries(current), ...keys.map(key => [key, { ...template }])])); setShowPattern(false); setMessage(`${staffIds.length}명에게 ${patternDays.length}개 요일 반복 패턴을 적용했어요.`);
  };
  const copyFrom = mode => {
    let copied = 0; const additions = {};
    visibleEmployees.forEach(employee => dates.forEach(date => {
      const target = dateFromKey(date); const source = new Date(target);
      if (mode === 'week') source.setDate(source.getDate() - 7);
      else {
        const targetDay = source.getDate();
        source.setDate(1);
        source.setMonth(source.getMonth() - 1);
        const previousMonthLastDay = new Date(source.getFullYear(), source.getMonth() + 1, 0).getDate();
        source.setDate(Math.min(targetDay, previousMonthLastDay));
      }
      const value = existingFor(employee, formatDateKey(source));
      if (value) { additions[keyFor(employee.id, date)] = rowAsTemplate(value); copied += 1; }
    }));
    setDrafts(current => ({ ...current, ...additions })); setMessage(copied ? `${mode === 'week' ? '이전 주' : '전월'} 일정 ${copied}건을 임시 복사했어요.` : '복사할 기존 일정이 없습니다.');
  };
  const requiredFor = teamName => Math.max(0, Number(staffingNeeds[teamName]) || 0);
  const staffingFor = date => { const counts = new Map(); employees.forEach(employee => { const value = effectiveFor(employee, date); if (value?.startsAt) counts.set(employee.team, (counts.get(employee.team) || 0) + 1); }); return counts; };
  const warnings = useMemo(() => {
    const result = [];
    employees.forEach(employee => {
      const workDates = dates.filter(date => effectiveFor(employee, date)?.startsAt);
      workDates.forEach(date => {
        const leave = leaveRequests.find(request => request.status !== '반려' && (request.staffId === employee.id || request.employee === employee.name) && request.startsAt <= date && (request.endsAt || request.startsAt) >= date);
        if (leave) result.push({ type: '휴가 충돌', text: `${employee.name} · ${formatKoreanDate(date)} · ${leave.type}` });
      });
      let streak = 0; dates.forEach(date => { if (workDates.includes(date)) streak += 1; else streak = 0; if (streak === 7) result.push({ type: '연속 근무', text: `${employee.name} · 7일 이상 연속 근무` }); });
      for (let start = 0; start < dates.length; start += 7) { const week = dates.slice(start, start + 7); const minutes = week.reduce((sum, date) => { const value = effectiveFor(employee, date); if (!value?.startsAt) return sum; let duration = clockMinutes(value.endsAt) - clockMinutes(value.startsAt); if (duration <= 0) duration += 1440; return sum + Math.max(0, duration - Number(value.breakMinutes || 0)); }, 0); if (minutes > 52 * 60) result.push({ type: '주간시간', text: `${employee.name} · ${Math.floor(start / 7) + 1}주차 ${formatHours(minutes)}` }); }
    });
    dates.forEach(date => { const counts = staffingFor(date); Object.keys(staffingNeeds).forEach(teamName => { const required = requiredFor(teamName); const actual = counts.get(teamName) || 0; if (required && actual < required) result.push({ type: '인원 부족', text: `${formatKoreanDate(date)} · ${teamName} ${actual}/${required}명` }); }); });
    return result.slice(0, 30);
  }, [drafts, employees, leaveRequests, monthKey, staffingNeeds, scheduleByDate]);
  const mobileDates = dates.slice(mobileWeek * 7, mobileWeek * 7 + 7);
  useEffect(() => {
    document.querySelectorAll('.monthly-template-bar button:not(.apply-template)').forEach(button => button.style.setProperty('--template-color', shiftColorFor(button.querySelector('small') ? button.childNodes[0]?.textContent : button.textContent, shiftColors)));
    document.querySelectorAll('.monthly-edit-grid td>button').forEach(button => { const label = button.querySelector('b')?.textContent; if (label && label !== '＋') button.style.setProperty('--cell-color', shiftColorFor(label, shiftColors)); });
  }, [shiftColors, drafts, scheduleByDate, monthKey]);
  useEffect(() => {
    if (monthKey !== todayKey.slice(0, 7)) return;
    const todayColumn = monthlyGridRef.current?.querySelector(`[data-schedule-date="${todayKey}"]`);
    if (!todayColumn) return;
    const weekIndex = Math.floor((Number(todayKey.slice(8)) - 1) / 7);
    setMobileWeek(weekIndex);
    window.requestAnimationFrame(() => todayColumn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
  }, [monthKey]);
  const changeCalendarScale = value => { setCalendarScale(value); localStorage.setItem(`${STORAGE_PREFIX}monthly-calendar-scale`, value); };
  return <div className={`monthly-editor monthly-calendar-${calendarScale}${calendarFocus ? ' monthly-calendar-focus' : ''}`}>
    <div className="monthly-editor-guide"><div><strong>1</strong><span><b>직원과 날짜 선택</b><small>여러 칸을 드래그하거나 직원 행을 눌러 한 번에 선택</small></span></div><i/>
      <div><strong>2</strong><span><b>근무 유형 적용</b><small>풀타임·오전·오후·휴무 중 선택</small></span></div><i/>
      <div><strong>3</strong><span><b>한 번에 저장</b><small>변경 건수와 충돌 경고를 확인하고 저장</small></span></div>
    </div>
    <div className="monthly-editor-toolbar"><label>편성 월<span className="monthly-month-control"><input type="month" value={monthKey} onChange={event => { setMonthKey(event.target.value); setSelected([]); setMobileWeek(0); }}/><button type="button" disabled={monthKey === todayKey.slice(0, 7)} onClick={() => { setMonthKey(todayKey.slice(0, 7)); setSelected([]); }}>오늘</button></span></label><label>구분<select value={team} onChange={event => setTeam(event.target.value)}>{teams.map(value => <option key={value}>{value}</option>)}</select></label><label className="monthly-search">직원 검색<input value={query} onChange={event => setQuery(event.target.value)} placeholder="이름·직책 검색"/></label><div className="monthly-editor-count"><b>{visibleEmployees.length}명</b><span>{draftRows.length}건 변경</span></div></div>
    <div className="monthly-advanced-tools"><button type="button" onClick={() => copyFrom('week')}>이전 주 복사</button><button type="button" onClick={() => copyFrom('month')}>전월 복사</button><button type="button" className={showPattern ? 'selected' : ''} onClick={() => setShowPattern(value => !value)}>반복 패턴</button><button type="button" className={`monthly-focus-toggle${calendarFocus ? ' selected' : ''}`} aria-pressed={calendarFocus} onClick={() => setCalendarFocus(value => !value)}>{calendarFocus ? '기본 화면 보기' : '⛶ 캘린더 크게 보기'}</button><div className="monthly-calendar-scale" role="group" aria-label="캘린더 크기">{[['compact','작게'],['default','기본'],['large','크게']].map(([value,label]) => <button type="button" key={value} className={calendarScale === value ? 'selected' : ''} aria-pressed={calendarScale === value} onClick={() => changeCalendarScale(value)}>{label}</button>)}</div><span>마우스로 칸을 누른 채 이동하면 여러 날짜를 선택할 수 있어요.</span></div>
    {showPattern && <div className="monthly-pattern-panel"><b>반복 요일</b>{KOREAN_WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={patternDays.includes(index)} onChange={() => setPatternDays(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index])}/>{day}</label>)}<button type="button" onClick={applyPattern} disabled={!patternDays.length}>선택 직원에 반복 적용</button></div>}
    <div className="staffing-needs"><b>구분별 하루 필요 인원</b>{teams.filter(value => value !== '전체').map(value => <label key={value}>{value}<input type="number" min="0" max="99" value={staffingNeeds[value] || ''} placeholder="0" onChange={event => { const next = { ...staffingNeeds, [value]: Number(event.target.value) || 0 }; setStaffingNeeds(next); localStorage.setItem(`${STORAGE_PREFIX}schedule-staffing-needs`, JSON.stringify(next)); }}/><span>명</span></label>)}</div>
    <div className="monthly-template-bar"><strong>빠른 근무 선택</strong>{MONTHLY_SHIFT_TEMPLATES.map(value => <button type="button" className={template.id === value.id ? 'selected' : ''} style={{ '--template-color': value.color }} onClick={() => chooseTemplate(value)} key={value.id}>{value.label}<small>{value.startsAt ? `${value.startsAt}~${value.endsAt}${value.breakMinutes ? ` · 휴게 ${formatHours(value.breakMinutes)}` : ''}` : '근무 없음'}</small></button>)}<button type="button" className="apply-template" onClick={applyTemplate}>선택 칸에 근무 적용</button></div>
    <div className="mobile-week-switch"><button type="button" disabled={mobileWeek === 0} onClick={() => setMobileWeek(value => value - 1)}>‹</button><b>{mobileDates[0]?.slice(5)} ~ {mobileDates.at(-1)?.slice(5)}</b><button type="button" disabled={(mobileWeek + 1) * 7 >= dates.length} onClick={() => setMobileWeek(value => value + 1)}>›</button></div>
    <div className="monthly-grid-wrap" ref={monthlyGridRef}><table className="monthly-edit-grid"><thead><tr><th className="sticky-person">직원 / 구분</th>{dates.map((date, dateIndex) => { const day = dateFromKey(date); const counts = staffingFor(date); const shortage = [...counts.keys(), ...Object.keys(staffingNeeds)].some(teamName => requiredFor(teamName) > (counts.get(teamName) || 0)); return <th data-schedule-date={date} className={`${day.getDay() === 0 ? 'sun ' : day.getDay() === 6 ? 'sat ' : ''}${date === todayKey ? 'today-column ' : ''}${shortage ? 'shortage ' : ''}${Math.floor(dateIndex / 7) !== mobileWeek ? 'outside-mobile-week' : ''}`} key={date}><span>{date === todayKey ? '오늘' : KOREAN_WEEKDAYS[day.getDay()]}</span><b>{day.getDate()}</b><small>근무 {[...counts.values()].reduce((sum, value) => sum + value, 0)}</small></th>; })}</tr></thead><tbody>{visibleEmployees.map(employee => <tr key={employee.id}><th className="sticky-person"><button type="button" onClick={() => selectEmployee(employee.id)}><Avatar name={employee.name} color={employee.color}/><span><b>{employee.name}</b><small>{employee.team} · {employee.role}</small></span></button></th>{dates.map((date, dateIndex) => { const key = keyFor(employee.id, date); const draft = drafts[key]; const existing = existingFor(employee, date); const label = draft?.label || (existing?.[1] === '휴무' ? '휴무' : existing?.[2]); const time = draft ? (draft.startsAt ? `${draft.startsAt}~${draft.endsAt}` : '') : existing?.[1]; return <td className={`${date === todayKey ? 'today-column ' : ''}${Math.floor(dateIndex / 7) !== mobileWeek ? 'outside-mobile-week' : ''}`} key={date}><button type="button" className={`${selected.includes(key) ? 'selected ' : ''}${draft ? 'draft ' : ''}${existing ? 'existing' : ''}`} style={{ '--cell-color': draft?.color || employee.categoryColor }} onPointerDown={event => { event.preventDefault(); setDragging(true); toggle(employee.id, date, event); }} onPointerEnter={() => dragSelect(employee.id, date)}><b>{label || '＋'}</b>{time && time !== '휴무' && <small>{String(time).replace(' – ', '~')}</small>}</button></td>; })}</tr>)}</tbody></table></div>
    <section className={`monthly-detail-editor ${selected.length ? 'active' : ''}`}><div className="monthly-detail-title"><span><b>선택한 일정 상세 설정</b><small>{selected.length ? `${selected.length}개 직원·날짜 칸 선택됨` : '캘린더에서 날짜 칸을 선택하면 설정할 수 있어요.'}</small></span>{selected.length > 0 && <button type="button" onClick={() => setSelected([])}>선택 해제</button>}</div><label>근무형태<select value={detailShiftName} onChange={event => { const name = event.target.value; setDetailShiftName(name); const matched = MONTHLY_SHIFT_TEMPLATES.find(item => item.label === name); if (matched) chooseTemplate(matched); }}>{registeredShiftTypes.map(value => <option value={value} key={value}>{value}</option>)}</select></label><label>시작<select value={detailStartsAt} disabled={detailShiftName.includes('휴무')} onChange={event => setDetailStartsAt(event.target.value)}>{SCHEDULE_TIME_OPTIONS.map(value => <option value={value} key={`start-${value}`}>{value}</option>)}</select></label><label>종료<select value={detailEndsAt} disabled={detailShiftName.includes('휴무')} onChange={event => setDetailEndsAt(event.target.value)}>{SCHEDULE_TIME_OPTIONS.map(value => <option value={value} key={`end-${value}`}>{value}</option>)}</select></label><label>휴게시간<input type="number" min="0" max="480" step="10" value={detailBreakMinutes} disabled={detailShiftName.includes('휴무')} onChange={event => setDetailBreakMinutes(event.target.value)}/><em>분</em></label><label className="break-pay-toggle compact"><input type="checkbox" checked={detailBreakPaid} disabled={detailShiftName.includes('휴무') || !Number(detailBreakMinutes)} onChange={event => setDetailBreakPaid(event.target.checked)}/><span><b>급여 포함</b><small>유급 휴게</small></span></label><div className="monthly-detail-actions"><button type="button" className="undo-selected" disabled={busy || !selectedDraftKeys.length} onClick={undoSelectedDrafts}>임시 변경 되돌리기 {selectedDraftKeys.length ? `(${selectedDraftKeys.length}건)` : ''}</button><button type="button" className="cancel-selected" disabled={busy || !selectedExistingSchedules.length} onClick={cancelSelectedSchedules}>등록 일정 삭제 {selectedExistingSchedules.length ? `(${selectedExistingSchedules.length}건)` : ''}</button><button type="button" className="apply-detail" disabled={!selected.length} onClick={applyDetails}>선택 칸에 근무 적용</button></div></section>
    {warnings.length > 0 && <div className="monthly-warning-panel"><div><b>자동 점검 {warnings.length}건</b><span>저장은 가능하지만 승인 전에 확인해 주세요.</span></div><ul>{warnings.map((warning, index) => <li key={`${warning.type}-${warning.text}-${index}`}><strong>{warning.type}</strong>{warning.text}</li>)}</ul></div>}
    <div className="monthly-editor-footer"><div>{message && <p>{message}</p>}<span>{selected.length}칸 선택 · 저장 전 변경 {draftRows.length}건{existingOverwriteCount ? ` · 기존 일정 ${existingOverwriteCount}건 수정` : ''}</span><small>{requiresApproval ? '변경사항을 저장하면 최고관리자 승인 대기로 전환됩니다.' : '변경사항을 저장해야 실제 스케줄에 반영됩니다.'}</small></div><button type="button" className="reset-drafts" onClick={resetAllDrafts} disabled={busy || !draftRows.length}>모든 임시 변경 되돌리기</button><button type="button" className="outline" onClick={closeEditor} disabled={busy}>저장하지 않고 닫기</button><button type="button" className="submit" onClick={submit} disabled={busy || !draftRows.length}>{busy ? '저장 중…' : `변경사항 저장 (${draftRows.length}건)`}</button></div>
  </div>;
}

function Schedule({ setModal, employees, onSelect, scheduleByDate, leaveRequests, onEdit, isOwner, onReview, canManage = false, shiftTypeColors = {} }) {
  const days = weekDaysFor(todayKey); const [monthKey, setMonthKey] = useState(todayKey.slice(0, 7)); const monthCells = monthDaysFor(monthKey);
  const [selectedDate, setSelectedDate] = useState(todayKey); const [viewMode, setViewMode] = useState('day'); const selectedIndex = days.findIndex(day => day.id === selectedDate); const selectedDay = days[selectedIndex] || days[0]; const shifts = scheduleByDate[selectedDate] || [];
  const [rangeFrom, setRangeFrom] = useState(`${todayKey.slice(0,7)}-01`); const [rangeTo, setRangeTo] = useState(todayKey);
  const savedShiftColors = useShiftColors(employees[0]?.organizationId);
  const pdfShiftColors = { ...savedShiftColors, ...shiftTypeColors };
  useEffect(() => { document.querySelectorAll('.shift-list .shift').forEach(row => { const label = row.querySelector('.grow small')?.textContent?.split(' · ')[0]; const color = shiftColorFor(label, pdfShiftColors); row.style.setProperty('--shift-color', color); row.classList.add('shift-colored'); }); }, [shifts, pdfShiftColors]);
  const changeDate = (offset) => { const next = days[selectedIndex + offset]; if (next) setSelectedDate(next.id); };
  const changeMonth = (offset) => { const [year, month] = monthKey.split('-').map(Number); const next = new Date(year, month - 1 + offset, 1, 12); setMonthKey(formatDateKey(next).slice(0, 7)); };
  const workCount = shifts.filter(([, time]) => time !== '휴무' && time !== '연차').length; const offCount = shifts.filter(([, time]) => time === '휴무').length; const leaveCount = shifts.filter(([, time]) => time === '연차').length; const categoryCounts = categoryCountsForSchedules(shifts, employees);
  const nextView = () => setViewMode(viewMode === 'day' ? 'week' : viewMode === 'week' ? 'month' : 'day');
  const monthLabel = monthLabelFor(monthKey);
  const rangeRows = Object.entries(scheduleByDate).filter(([date]) => date >= rangeFrom && date <= rangeTo).flatMap(([date, rows]) => rows.map(row => ({ date, row })));
  useEffect(()=>{const tools=document.querySelector('.schedule-range-tools');if(!tools)return;const old=tools.querySelector('.schedule-pdf-button');if(old)old.remove();const button=document.createElement('button');button.type='button';button.className='outline schedule-pdf-button';button.textContent=`PDF 한눈에 보기 (${rangeRows.length}건)`;button.disabled=!rangeRows.length||rangeFrom>rangeTo;button.onclick=()=>{const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));const readableShift=row=>{const label=String(row[2]||'').trim();if(label&&!/^[A-Z](?:\/[A-Z])?$/i.test(label))return label;const [start,end]=String(row[1]||'').split(' – ');if(start&&end&&clockMinutes(start)>=12)return'오후 근무';if(start&&end&&clockMinutes(end)<=13*60)return'오전 근무';return'근무';};const safeColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?value:'#8B95A1';const dates=[];for(let cursor=dateFromKey(rangeFrom),end=dateFromKey(rangeTo);cursor<=end;cursor.setDate(cursor.getDate()+1))dates.push(formatDateKey(cursor));const people=[...new Map(rangeRows.map(({row})=>[row[4]||row[0],{id:row[4]||row[0],name:row[0],team:row[5]||'미분류',color:safeColor(row[6])}])).values()];const rowMap=new Map(rangeRows.map(({date,row})=>[`${row[4]||row[0]}:${date}`,row]));const body=people.map(person=>`<tr><th><b>${escape(person.name)}</b><small><i style="background:${person.color}"></i>${escape(person.team)}</small></th>${dates.map(date=>{const row=rowMap.get(`${person.id}:${date}`);if(!row)return'<td class="empty"></td>';if(row[1]==='휴무')return'<td class="off"><b>휴무</b></td>';return`<td><b>${escape(readableShift(row))}</b><span>${escape(row[1]?.replace(' – ','~'))}</span>${Number(row[7])>0?`<small>휴게 ${escape(formatHours(row[7]))}</small>`:''}${row[8]&&row[8]!=='approved'?`<em>${row[8]==='pending'?'승인 대기':'반려'}</em>`:''}</td>`;}).join('')}</tr>`).join('');const popup=window.open('','_blank');if(!popup)return;popup.opener=null;popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>스케줄 ${escape(rangeFrom)}_${escape(rangeTo)}</title><style>@page{size:A3 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:#191f28}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:12px}h1{margin:0;font-size:24px}header p{margin:4px 0 0;color:#6b7684;font-size:12px}header strong{font-size:13px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #dfe5ec}thead th{height:38px;background:#f5f7fa;font-size:10px}thead th:first-child{width:105px}tbody th{padding:7px;text-align:left;background:#fafbfc}tbody th b,tbody th small{display:block}tbody th b{font-size:11px}tbody th small{margin-top:4px;color:#6b7684;font-size:8px}tbody th i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px}td{height:58px;padding:4px;text-align:center;vertical-align:middle}td b,td span,td small,td em{display:block;overflow:hidden;text-overflow:ellipsis}td b{font-size:8px;line-height:1.2}td span{margin-top:3px;font-size:7px;color:#333d4b}td small{margin-top:2px;font-size:6.5px;color:#6b7684}td em{margin-top:2px;color:#f04452;font-size:6px;font-style:normal}.off{background:#f2f4f6}.off b{font-size:10px}.empty{background:#fff}footer{display:flex;justify-content:space-between;margin-top:9px;color:#8b95a1;font-size:9px}.print{position:fixed;right:18px;bottom:18px;border:0;border-radius:10px;background:#3182f6;color:#fff;padding:12px 18px;font-weight:700}@media print{.print{display:none}}</style></head><body><header><div><h1>근무 스케줄</h1><p>코드 대신 실제 근무 형태·시간·휴게 정보를 표시합니다.</p></div><strong>${escape(rangeFrom)} ~ ${escape(rangeTo)}</strong></header><table><thead><tr><th>직원 / 구분</th>${dates.map(date=>`<th>${Number(date.slice(8))}<br>${KOREAN_WEEKDAYS[dateFromKey(date).getDay()]}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table><footer><span>빈칸: 등록된 일정 없음</span><span>Timefit · ${new Date().toLocaleString('ko-KR')}</span></footer><button class="print" onclick="window.print()">PDF로 저장 / 인쇄</button></body></html>`);popup.document.close();};tools.appendChild(button);return()=>button.remove();},[rangeFrom,rangeTo,rangeRows.length,scheduleByDate]);
  useEffect(()=>{const button=document.querySelector('.schedule-pdf-button');if(!button)return;button.onclick=()=>openSchedulePrintView({rangeRows,rangeFrom,rangeTo,weekdays:KOREAN_WEEKDAYS,shiftTypeColors:pdfShiftColors});},[rangeRows,rangeFrom,rangeTo,pdfShiftColors]);
  const pendingRows = Object.entries(scheduleByDate).flatMap(([date, rows]) => rows.filter(row => row[8] === 'pending').map(row => ({ date, row })));
  useEffect(() => {
    if (!isOwner || !pendingRows.length || typeof onReview?.all !== 'function') return;
    const title = document.querySelector('.schedule-approval-queue .card-title');
    if (!title) return;
    const previous = title.querySelector('.approve-all-schedules');
    if (previous) previous.remove();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'submit approve-all-schedules';
    button.textContent = `전체 승인 (${pendingRows.length}건)`;
    button.onclick = async () => {
      if (!window.confirm(`승인 대기 스케줄 ${pendingRows.length}건을 모두 승인할까요?`)) return;
      button.disabled = true;
      button.textContent = '전체 승인 중…';
      await onReview.all(pendingRows.map(({ row }) => row[3]));
    };
    title.appendChild(button);
    return () => button.remove();
  }, [isOwner, onReview, pendingRows.length]);
  useEffect(() => {
    if (!canManage) return;
    const rangeTools = document.querySelector('.schedule-range-tools');
    const pageTitle = rangeTools?.previousElementSibling;
    const singleButton = pageTitle?.querySelector('.cta');
    if (!pageTitle?.classList.contains('page-title') || !singleButton) return;
    singleButton.textContent = '1명·특정일 등록';
    singleButton.classList.remove('cta');
    singleButton.classList.add('outline', 'schedule-single-add');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cta open-monthly-editor';
    button.textContent = '▦ 캘린더 일괄 등록';
    button.onclick = () => setModal('scheduleGrid');
    singleButton.after(button);
    return () => {
      button.remove();
      singleButton.textContent = '+ 근무 추가';
      singleButton.classList.remove('outline', 'schedule-single-add');
      singleButton.classList.add('cta');
    };
  }, [canManage, setModal]);
  const download = () => { const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`; const csv = ['날짜,구분,직원,근무형태,근무시간,휴게시간(분),승인상태', ...rangeRows.map(({date,row}) => [date,row[5],row[0],row[2],row[1],row[7],row[8] === 'pending' ? '승인 대기' : row[8] === 'rejected' ? '반려' : '승인 완료'].map(quote).join(','))].join('\n'); const url = URL.createObjectURL(new Blob([`\ufeff${csv}`],{type:'text/csv;charset=utf-8'})); const link=document.createElement('a'); link.href=url; link.download=`timefit-schedule-${rangeFrom}-${rangeTo}.csv`; link.click(); URL.revokeObjectURL(url); };
  const staffNames = (items, limit) => { const people = schedulePeople(items, employees); return <span className="board-staff-names">{people.length ? <>{people.slice(0, limit).map(person => <em key={person.id} style={{ '--category-color': person.color }}><i/><span><small>{person.team}</small>{person.name}</span></em>)}{people.length > limit && <strong>외 {people.length - limit}명</strong>}</> : '등록된 근무 없음'}</span>; };
  return <><div className="page-title"><div><p>{monthLabel} · 실제 등록 데이터</p><h1>스케줄</h1></div>{canManage && <button className="cta" onClick={() => setModal('schedule')}>+ 근무 추가</button>}</div><section className="card schedule-range-tools"><div><b>기간별 스케줄 확인·배포</b><p>기간을 선택해 직원 공유용 CSV로 내려받을 수 있어요.</p></div><label>시작일<input type="date" value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)}/></label><label>종료일<input type="date" min={rangeFrom} value={rangeTo} onChange={e=>setRangeTo(e.target.value)}/></label><button className="outline" disabled={!rangeRows.length || rangeFrom>rangeTo} onClick={download}>CSV 다운로드 ({rangeRows.length}건)</button></section>{isOwner && pendingRows.length>0 && <section className="card schedule-approval-queue"><div className="card-title"><div><h2>스케줄 승인 대기</h2><p>관리자·총괄셰프가 만든 일정은 승인 후 직원에게 공개됩니다.</p></div><span className="count">{pendingRows.length}</span></div>{pendingRows.map(({date,row})=><div className="approval" key={row[3]}><Avatar name={row[0]}/><span><b>{row[0]} · {formatKoreanDate(date)}</b><small>{row[5]} · {row[1]} · {row[2]}</small></span><button className="reject" onClick={()=>onReview(row[3],'rejected')}>반려</button><button className="submit" onClick={()=>onReview(row[3],'approved')}>승인</button></div>)}</section>}<section className="card schedule-card"><div className="schedule-tools"><button onClick={() => changeDate(-1)} disabled={viewMode !== 'day' || selectedIndex === 0}>‹</button><b>{viewMode === 'day' ? selectedDay.label : viewMode === 'week' ? `${days[0].label} ~ ${days[6].label}` : monthLabel}</b><button onClick={() => changeDate(1)} disabled={viewMode !== 'day' || selectedIndex === days.length - 1}>›</button><span/><button className="outline" onClick={nextView}>{viewMode === 'day' ? '주간 보기' : viewMode === 'week' ? '월간 보기' : '일간 보기'}</button></div><div className="mobile-week-strip">{days.map(day => <button className={day.id === selectedDate ? 'active' : ''} onClick={() => { setSelectedDate(day.id); setViewMode('day'); }} key={day.id}><b>{day.weekday}</b><span>{day.day}</span></button>)}</div><div className="schedule-summary">{categoryCounts.length ? categoryCounts.map(item => <span className="schedule-category-total" key={item.name} style={{ '--category-color': item.color }}><i/>{item.name} <b>{item.count}명</b></span>) : <span>근무 <b>{workCount}명</b></span>}<span>휴무 <b>{offCount}명</b></span><span>연차 <b>{leaveCount}명</b></span></div>{viewMode === 'week' && <div className="weekly-schedule-board">{days.map(day => { const items = scheduleByDate[day.id] || []; return <button key={day.id} onClick={() => { setSelectedDate(day.id); setViewMode('day'); }}><b>{day.weekday} {day.day}</b>{staffNames(items, 4)}<small>휴무 {items.filter(([, time]) => time === '휴무').length} · 연차 {items.filter(([, time]) => time === '연차').length}</small></button>; })}</div>}{viewMode === 'month' && <div className="monthly-schedule-board">{KOREAN_WEEKDAYS.map(day => <b key={day}>{day}</b>)}{monthCells.map(cell => { const items = scheduleByDate[cell.id] || []; const workTotal = items.filter(([, time]) => time !== '휴무' && time !== '연차').length; const offTotal = items.filter(([, time]) => time === '휴무').length; const leaveTotal = leaveRequests.filter(request => request.status !== '반려' && request.startsAt <= cell.id && (request.endsAt || request.startsAt) >= cell.id).length; return cell.inMonth ? <button className={`${cell.id === todayKey ? 'today ' : ''}${workTotal || offTotal || leaveTotal ? 'has-schedule' : ''}`} onClick={() => { setSelectedDate(cell.id); setViewMode('day'); }} key={cell.id}><b>{cell.day}</b>{staffNames(items, 2)}<small>휴무 {offTotal} · 휴가 {leaveTotal}</small></button> : <i key={cell.id}/>; })}</div>}<div className={`shift-list ${viewMode !== 'day' ? 'hidden' : ''}`}>{shifts.length ? shifts.map(([name,time,label,id,staffId,,,breakMinutes,approvalStatus]) => { const employee = employees.find(item => item.name === name) || { name, color: 'blue' }; return <div className="shift clickable-row" key={`${selectedDate}-${name}`} onClick={() => onSelect(employee)}><Avatar name={name} color={employee.color}/><div className="grow"><b>{name}</b><small>{label}{Number(breakMinutes)>0?` · 휴게 ${formatHours(breakMinutes)}`:''}</small></div>{approvalStatus && approvalStatus!=='approved' && <Chip type={approvalStatus==='pending'?'orange':'gray'}>{approvalStatus==='pending'?'승인 대기':'반려'}</Chip>}<div className="shift-time-block"><strong>{time}</strong><span>직원 상세 보기 ›</span></div><button className="ghost" onClick={(event) => { event.stopPropagation(); onEdit({ id, staffId: staffId || employee.id, name, time, label, date: selectedDate, breakMinutes: Number(breakMinutes)||0 }); }}>수정</button></div>; }) : <div className="empty-schedule"><b>등록된 근무가 없어요.</b><span>근무 추가 버튼으로 새 일정을 만들어 보세요.</span></div>}</div></section></>;
}

function ScheduleEditForm({ schedule, onSave, onDelete }) {
  const timeMatch = String(schedule.time || '').match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
  const startsAt = timeMatch?.[1] || '09:00'; const endsAt = timeMatch?.[2] || '18:00';
  const [start, setStart] = useState(startsAt); const [end, setEnd] = useState(endsAt); const [shiftName, setShiftName] = useState(schedule.label || '일반 근무'); const [breakMinutes, setBreakMinutes] = useState(String(schedule.breakMinutes ?? 0)); const [breakPaid, setBreakPaid] = useState(Boolean(schedule.breakPaid)); const [breakStart,setBreakStart]=useState(schedule.breakStartsAt||''); const [breakEnd,setBreakEnd]=useState(schedule.breakEndsAt||''); const [deleting, setDeleting] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async event => { event.preventDefault(); setBusy(true); try { await onSave({ ...schedule, startsAt: start, endsAt: end, shiftName, breakMinutes: Number(breakMinutes) || 0, breakPaid, breakStartsAt:breakStart||null, breakEndsAt:breakEnd||null }); } finally { setBusy(false); } };
  return <form onSubmit={submit} className="schedule-edit-form"><div className="schedule-edit-summary"><b>{schedule.name}</b><span>{formatKoreanDate(schedule.date)} · 기존 {schedule.time}</span></div><div className="form-row"><label>시작 시간<input type="time" value={start} onChange={event => setStart(event.target.value)} required/></label><label>종료 시간<input type="time" value={end} onChange={event => setEnd(event.target.value)} required/></label></div><div className="form-row"><label>휴게시간(분)<input type="number" min="0" max="480" step="10" value={breakMinutes} onChange={event => setBreakMinutes(event.target.value)} required/><small>예: 2시간은 120분</small></label><label className="break-pay-toggle"><input type="checkbox" checked={breakPaid} disabled={!Number(breakMinutes)} onChange={event => setBreakPaid(event.target.checked)}/><span><b>휴게시간 급여 포함</b><small>체크 시 유급 근무시간으로 계산</small></span></label></div><label>근무 형태<input value={shiftName} onChange={event => setShiftName(event.target.value)} required/></label>{deleting ? <div className="schedule-delete-confirm"><b>이 근무 일정을 취소할까요?</b><span>취소하면 스케줄표와 직원 일정에서 즉시 제거됩니다.</span><div><button type="button" className="outline" onClick={() => setDeleting(false)}>돌아가기</button><button type="button" className="danger" disabled={busy} onClick={() => onDelete(schedule)}>일정 취소</button></div></div> : <div className="schedule-edit-actions"><button type="button" className="delete-link" onClick={() => setDeleting(true)}>일정 취소</button><button className="submit" disabled={busy}>{busy ? '저장 중…' : '수정 저장'}</button></div>}</form>;
}

function ScheduleDatePicker({ dates, mode, schedules, leaveRequests, onChange, onClose }) {
  const [monthKey, setMonthKey] = useState(todayKey.slice(0, 7));
  const calendarSizes = ['compact', 'default', 'large'];
  const calendarSizeLabels = { compact: '작게', default: '기본', large: '크게' };
  const [calendarSize, setCalendarSize] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}schedule-calendar-size`);
    return calendarSizes.includes(saved) ? saved : 'default';
  });
  const cells = monthDaysFor(monthKey);
  const changeMonth = amount => { const [year, month] = monthKey.split('-').map(Number); setMonthKey(formatDateKey(new Date(year, month - 1 + amount, 1, 12)).slice(0, 7)); };
  const changeSize = size => { setCalendarSize(size); localStorage.setItem(`${STORAGE_PREFIX}schedule-calendar-size`, size); };
  const select = id => { onChange(mode === 'single' ? [id] : dates.includes(id) ? dates.filter(date => date !== id) : [...dates, id]); if (mode === 'single') onClose(); };
  return <Modal title="근무일 선택" onClose={onClose} variant={`schedule-date-modal calendar-size-${calendarSize}`}><div className="calendar-size-control" role="group" aria-label="달력 크기">{calendarSizes.map(size => <button type="button" key={size} className={calendarSize === size ? 'active' : ''} aria-pressed={calendarSize === size} onClick={() => changeSize(size)}>{calendarSizeLabels[size]}</button>)}</div><div className="date-picker-head"><button type="button" aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><b>{monthLabelFor(monthKey)}</b><button type="button" aria-label="다음 달" onClick={() => changeMonth(1)}>›</button></div><div className="date-picker-helper"><p className="modal-text">날짜를 선택하면 등록된 근무·휴가 현황을 함께 확인할 수 있어요.</p><button type="button" disabled={monthKey === todayKey.slice(0, 7)} onClick={() => setMonthKey(todayKey.slice(0, 7))}>이번 달</button></div><div className="date-picker-scroll"><div className="calendar-weekdays">{KOREAN_WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div><div className="schedule-date-calendar">{cells.map(cell => { const items = schedules[cell.id] || []; const leaveCount = leaveRequests.filter(request => request.status !== '반려' && request.startsAt <= cell.id && (request.endsAt || request.startsAt) >= cell.id).length; const workCount = items.filter(([, time]) => time !== '휴무' && time !== '연차').length; const selected = dates.includes(cell.id); return <button type="button" key={cell.id} disabled={!cell.inMonth} className={`${selected ? 'selected ' : ''}${cell.id === todayKey ? 'today ' : ''}${!cell.inMonth ? 'outside' : ''}`} aria-pressed={selected} aria-label={`${formatKoreanDate(cell.id)}${workCount ? `, 근무 ${workCount}명` : ''}${leaveCount ? `, 휴가 ${leaveCount}명` : ''}`} onClick={() => select(cell.id)}><b>{cell.day}</b>{cell.inMonth && <span className="calendar-statuses">{workCount > 0 && <small className="work">근무 {workCount}</small>}{leaveCount > 0 && <small className="leave">휴가 {leaveCount}</small>}{!workCount && !leaveCount && <small className="available">선택 가능</small>}</span>}</button>; })}</div></div><div className="date-picker-footer"><span><b>{mode === 'bulk' ? `${dates.length}일 선택됨` : dates[0] ? formatKoreanDate(dates[0]) : '날짜를 선택해 주세요'}</b>{mode === 'bulk' && dates.length > 0 && <small>{[...dates].sort().slice(0, 3).map(formatKoreanDate).join(' · ')}{dates.length > 3 ? ` 외 ${dates.length - 3}일` : ''}</small>}</span><button type="button" className="submit" onClick={onClose} disabled={!dates.length}>선택 완료</button></div></Modal>;
}

function ScheduleRegistrationForm({ employees, schedules, leaveRequests, organizationId, onSave, requiresApproval = false }) {
  const shiftColors = useShiftColors(organizationId);
  const [mode, setMode] = useState('group'); const [staffIds, setStaffIds] = useState([]); const [dates, setDates] = useState([todayKey]); const [startsAt, setStartsAt] = useState('09:00'); const [endsAt, setEndsAt] = useState('18:00'); const [shiftName, setShiftName] = useState('일반 근무'); const [breakMinutes, setBreakMinutes] = useState('0'); const [breakPaid, setBreakPaid] = useState(false); const [breakStartsAt,setBreakStartsAt]=useState(''); const [breakEndsAt,setBreakEndsAt]=useState(''); const [confirming, setConfirming] = useState(false); const [saving, setSaving] = useState(false); const [datePickerOpen, setDatePickerOpen] = useState(false); const [shiftTypes, setShiftTypes] = useState(DEFAULT_SHIFT_TYPES); const [customShift, setCustomShift] = useState(false); const [staffSearch,setStaffSearch]=useState('');
  useEffect(() => { const select = document.querySelector('.schedule-registration select'); if (select) { select.style.borderLeft = `6px solid ${shiftColorFor(shiftName, shiftColors)}`; select.style.backgroundColor = `color-mix(in srgb, ${shiftColorFor(shiftName, shiftColors)} 7%, white)`; } }, [shiftName, shiftColors]);
  useEffect(() => { if (!organizationId || !supabase) return; getOrganizationSettings(organizationId).then(settings => { if (settings?.shift_types?.length) { setShiftTypes(settings.shift_types); if (!settings.shift_types.includes(shiftName)) setShiftName(settings.shift_types[0]); } }).catch(() => {}); }, [organizationId]);
  useEffect(()=>{if(!breakStartsAt||!breakEndsAt)return;const minutes=(new Date(`2000-01-01T${breakEndsAt}`)-new Date(`2000-01-01T${breakStartsAt}`))/60000;setBreakMinutes(String(Math.max(0,minutes)));},[breakStartsAt,breakEndsAt]);
  const selectedStaff = employees.filter(employee => staffIds.includes(employee.id));
  const normalizedSearch=staffSearch.trim().toLowerCase();
  const filteredStaff=employees.filter(employee=>!normalizedSearch||`${employee.name} ${employee.team} ${employee.role}`.toLowerCase().includes(normalizedSearch));
  const toggleStaff=employeeId=>{setStaffIds(current=>mode==='single'?[employeeId]:current.includes(employeeId)?current.filter(id=>id!==employeeId):[...current,employeeId]);setConfirming(false);};
  const updateBreakWindow=(start,end)=>{setBreakStartsAt(start);setBreakEndsAt(end);if(start&&end){const minutes=(new Date(`2000-01-01T${end}`)-new Date(`2000-01-01T${start}`))/60000;setBreakMinutes(String(Math.max(0,minutes)));}};
  const dateConflicts = selectedStaff.flatMap(employee => dates.filter(date => (schedules[date] || []).some(([name]) => name === employee.name)).map(date => `${employee.name} · ${date}`));
  const leaveConflicts = selectedStaff.flatMap(employee => leaveRequests.filter(request => request.staffId === employee.id && request.status !== '반려' && dates.some(date => request.startsAt <= date && (request.endsAt || request.startsAt) >= date)).map(request => `${employee.name} · ${request.date}`));
  const submit = async event => { event.preventDefault(); const targetStaffIds = mode === 'single' ? [staffIds[0]] : staffIds; if (!targetStaffIds.length || !dates.length) return; if ((dateConflicts.length || leaveConflicts.length) && !confirming) { setConfirming(true); return; } setSaving(true); try { await onSave({ staffIds: targetStaffIds, dates, startsAt, endsAt, shiftName, breakMinutes, breakPaid, breakStartsAt:breakStartsAt||null, breakEndsAt:breakEndsAt||null, bulk: mode === 'bulk' }); } catch { /* 저장 실패 알림은 공통 알림 모달에서 표시한다. */ } finally { setSaving(false); } };
  return <><form onSubmit={submit} className="schedule-registration">
    <div className="schedule-mode"><button type="button" className={mode==='group'?'selected':''} onClick={()=>{setMode('group');setDates(dates.slice(0,1));}}>같은 날 여러 명</button><button type="button" className={mode==='single'?'selected':''} onClick={()=>{setMode('single');setStaffIds(staffIds.slice(0,1));setDates(dates.slice(0,1));}}>한 명 등록</button><button type="button" className={mode==='bulk'?'selected':''} onClick={()=>setMode('bulk')}>여러 날짜 일괄</button></div>
    <p className="modal-text">{mode==='group'?'같이 근무하는 직원을 묶어 같은 날짜와 시간으로 등록합니다.':mode==='bulk'?'여러 직원과 날짜의 모든 조합을 한 번에 등록합니다.':'직원 한 명의 일정을 등록합니다.'}</p>
    <fieldset className="selection-field"><legend>직원 선택 <small>{staffIds.length}명</small></legend><div className="schedule-staff-search"><input type="search" value={staffSearch} onChange={event=>setStaffSearch(event.target.value)} placeholder="직원 이름·구분·직책 검색" autoFocus/><span>{filteredStaff.length}명</span></div>{selectedStaff.length>0&&<div className="selected-staff-chips">{selectedStaff.map(employee=><button type="button" key={employee.id} onClick={()=>toggleStaff(employee.id)}>{employee.name}<span>×</span></button>)}</div>}<div className="selection-grid staff-selection">{filteredStaff.map(employee=><label key={employee.id}><input type={mode==='single'?'radio':'checkbox'} name="schedule-staff" checked={staffIds.includes(employee.id)} onChange={()=>toggleStaff(employee.id)}/><span>{employee.name}</span><small>{employee.team} · {employee.role}</small></label>)}{!filteredStaff.length&&<p className="empty-state">검색 결과가 없어요.</p>}</div></fieldset>
    <section className="date-picker-trigger"><div><b>근무일 선택</b><span>{dates.length?(mode==='bulk'?`${dates.length}일 선택됨`:formatKoreanDate(dates[0])):'날짜를 선택해 주세요'}</span></div><button type="button" className="outline" onClick={()=>setDatePickerOpen(true)}>날짜 선택</button></section>
    <div className="form-row"><label>시작 시간<input type="time" value={startsAt} onChange={event=>setStartsAt(event.target.value)} required/></label><label>종료 시간<input type="time" value={endsAt} onChange={event=>setEndsAt(event.target.value)} required/></label></div>
    <div className="form-row"><label>휴게 시작<input type="time" value={breakStartsAt} onChange={event=>updateBreakWindow(event.target.value,breakEndsAt)}/></label><label>휴게 종료<input type="time" value={breakEndsAt} onChange={event=>updateBreakWindow(breakStartsAt,event.target.value)}/></label></div>
    <div className="form-row"><label>휴게시간(분)<input type="number" min="0" max="480" value={breakMinutes} onChange={event=>setBreakMinutes(event.target.value)}/><small>{breakPaid?'급여에 포함되는 유급 휴게':'급여·실근무시간에서 제외'}</small></label><label className="break-pay-toggle"><input type="checkbox" checked={breakPaid} disabled={!Number(breakMinutes)} onChange={event=>setBreakPaid(event.target.checked)}/><span><b>휴게시간 급여 포함</b><small>체크 시 유급 근무시간으로 계산</small></span></label></div>
    <label>근무 형태<select value={customShift?'__custom__':shiftName} onChange={event=>{if(event.target.value==='__custom__'){setCustomShift(true);setShiftName('');}else{setCustomShift(false);setShiftName(event.target.value);}}}>{shiftTypes.map(type=><option key={type} value={type}>{type}</option>)}<option value="__custom__">직접 입력</option></select></label>
    {customShift&&<label>직접 입력한 근무 형태<input value={shiftName} onChange={event=>setShiftName(event.target.value)} required/></label>}<div className="bulk-preview"><b>등록 예정 {staffIds.length*dates.length}건</b><span>직원 {staffIds.length}명 × 날짜 {dates.length}일</span>{dateConflicts.length>0&&<p>기존 일정 {dateConflicts.length}건은 덮어씁니다.</p>}{leaveConflicts.length>0&&<p>휴가 신청 {leaveConflicts.length}건과 겹칩니다.</p>}</div>{confirming&&<div className="bulk-confirm"><b>기존 일정·휴가 충돌을 확인했어요.</b><span>계속 진행하면 기존 일정이 덮어쓰기 됩니다.</span></div>}<button className="submit" disabled={saving||!staffIds.length||!dates.length}>{saving?'저장 중…':confirming?'충돌 확인 후 저장':requiresApproval?'일정 승인 요청':staffIds.length>1?'묶어서 일정 등록':'일정 저장'}</button>
  </form>{datePickerOpen&&<ScheduleDatePicker dates={dates} mode={mode==='bulk'?'bulk':'single'} schedules={schedules} leaveRequests={leaveRequests} onChange={nextDates=>{setDates(nextDates);setConfirming(false);}} onClose={()=>setDatePickerOpen(false)}/>}</>;
}

function Leave({ setModal, employees, onSelect, leaveRequests }) { const pending = leaveRequests.filter(item => item.status === '승인 대기'); const approvedDays = leaveRequests.filter(item => item.status === '승인 완료').reduce((sum, item) => sum + Number(String(item.amount).replace('일', '')), 0); return <><div className="page-title"><div><p>{todayKey.slice(0, 4)}년 실제 신청 데이터</p><h1>휴가 · 연차 관리</h1></div><button className="cta" onClick={() => pending[0] && setModal(pending[0])}>요청 검토</button></div><section className="leave-overview"><div className="balance card"><p>승인된 휴가 사용</p><strong>{approvedDays}<small>일</small></strong><div><span>전체 직원 합계</span><span>승인 완료 기준</span></div><div className="progress"><i style={{ width: `${Math.min(100, approvedDays / Math.max(1, leaveRequests.length * 15) * 100)}%` }}/></div></div><div className="card leave-info"><h2>승인 대기 중인 휴가</h2><p>총 {pending.length}건의 요청을 확인해 주세요.</p><button onClick={() => pending[0] && setModal(pending[0])}>{pending.length ? '요청 확인하기 →' : '대기 중인 요청이 없어요'}</button></div></section><section className="card full-card"><div className="card-title"><div><h2>휴가 사용 내역</h2><p>Supabase 휴가 신청 순서</p></div></div>{leaveRequests.length ? leaveRequests.map(request => <div className="leave-row clickable-row" key={request.id} onClick={() => { onSelect(employees.find(item => item.name === request.employee)); if (request.status === '승인 대기') setModal(request); }}><span><b>{request.date}</b><small>{request.employee}</small></span><span>{request.type} · {request.amount}</span><Chip type={request.status === '승인 완료' ? 'green' : request.status === '반려' ? 'gray' : 'orange'}>{request.status}</Chip></div>) : <p className="empty-state">등록된 휴가 신청이 없어요.</p>}</section></> }

function Payroll({ employees, onSelect, canManage = false, onOpenPayroll }) {
  const [organizationId, setOrganizationId] = useState(''); const [month, setMonth] = useState(todayKey.slice(0, 7)); const [workspace, setWorkspace] = useState({ contracts: [], draft: null, lines: [] }); const [source, setSource] = useState(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const bounds = value => { const [year, monthNumber] = value.split('-').map(Number); return { start: `${value}-01`, end: `${value}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}` }; };
  const refresh = () => { if (!organizationId) return; setLoading(true); Promise.all([loadPayrollWorkspace(organizationId, month), loadWorkforce(organizationId, { payrollScope: true })]).then(([nextWorkspace, workforce]) => { setWorkspace(nextWorkspace); setSource(workforce); }).catch(error => setMessage(error.message || '급여 데이터를 불러오지 못했습니다.')).finally(() => setLoading(false)); };
  useEffect(() => { getAuthContext().then(context => setOrganizationId(context.membership?.organization_id || '')).catch(() => setMessage('사업장 정보를 불러오지 못했습니다.')); }, []);
  useEffect(() => { refresh(); }, [organizationId, month]);
  const rows = useMemo(() => { if (!source) return []; const { start, end } = bounds(month); return source.staff.map(staff => { const contract = workspace.contracts.filter(item => item.staff_id === staff.id && item.effective_from <= end && (!item.effective_to || item.effective_to >= start)).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]; const payType = contract?.pay_type || staff.pay_type; const rate = Number(payType === 'monthly' ? contract?.monthly_salary ?? staff.monthly_salary : payType === 'annual' ? contract?.annual_salary ?? staff.annual_salary : payType === 'daily' ? contract?.daily_wage ?? staff.daily_wage : contract?.hourly_wage ?? staff.hourly_wage) || 0; const records = source.attendance.filter(record => record.staff_id === staff.id && record.work_date >= start && record.work_date <= end); const attendanceCalculations = records.map(record => payableAttendanceMinutes(record, source.schedules || [], source.settings || DEFAULT_LEAVE_POLICY)); const workedMinutes = attendanceCalculations.reduce((sum, result) => sum + result.payableMinutes, 0); const breakMinutes = attendanceCalculations.reduce((sum, result) => sum + result.breakMinutes, 0); const completedDays = records.filter(record => record.checked_in_at && record.checked_out_at).length; const leaveDays = source.leaves.filter(item => item.staff_id === staff.id && item.status === 'approved' && item.starts_on <= end && item.ends_on >= start).reduce((sum, item) => sum + Number(item.amount || 0), 0); const basePay = payType === 'monthly' ? rate : payType === 'annual' ? rate / 12 : payType === 'daily' ? completedDays * rate : workedMinutes / 60 * rate; const saved = workspace.lines.find(item => item.staff_id === staff.id); return { staffId: staff.id, name: staff.account?.display_name || staff.display_name || '직원', payType, rate, workedMinutes, breakMinutes, completedDays, leaveDays, basePay, savedEstimatedTotal: saved ? Number(saved.estimated_total) : null, estimatedTotal: saved ? Number(saved.estimated_total) : basePay, hasContract: Boolean(contract) }; }); }, [source, workspace.contracts, workspace.lines, month]);
  const total = rows.reduce((sum, row) => sum + row.estimatedTotal, 0);
  const liveTotal = rows.reduce((sum, row) => sum + row.basePay, 0);
  const draftUpdatedAt = workspace.draft?.updated_at ? new Date(workspace.draft.updated_at) : null;
  const draftUpdatedLabel = draftUpdatedAt && !Number.isNaN(draftUpdatedAt.getTime()) ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(draftUpdatedAt) : '';
  const draftNeedsRefresh = Boolean(draftUpdatedAt && ((source?.attendance || []).some(record => new Date(record.checked_out_at || record.checked_in_at || 0).getTime() > draftUpdatedAt.getTime()) || (workspace.contracts || []).some(contract => new Date(contract.created_at || 0).getTime() > draftUpdatedAt.getTime())));
  const payrollDetails = useMemo(() => rows.flatMap(row => (source?.attendance || []).filter(record => record.staff_id === row.staffId && String(record.work_date || '').startsWith(month) && record.checked_in_at && record.checked_out_at).map(record => { const calculation = payableAttendanceMinutes(record, source?.schedules || [], source?.settings || DEFAULT_LEAVE_POLICY); const schedule = calculation.schedule; const timeLabel = value => value ? new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(new Date(value)) : '-'; return { name: row.name, payType: row.payType, rate: row.rate, date: record.work_date, shiftName: schedule?.shift_name || '스케줄 없음', scheduledTime: schedule ? `${String(schedule.starts_at).slice(0,5)}~${String(schedule.ends_at).slice(0,5)}` : '-', actualTime: `${timeLabel(record.checked_in_at)}~${timeLabel(record.checked_out_at)}`, grossMinutes: calculation.grossMinutes, scheduledMinutes: calculation.scheduledMinutes, breakMinutes: Number(schedule?.break_minutes || 0), breakPaid: Boolean(schedule?.break_paid), deductedBreakMinutes: calculation.breakMinutes, payableMinutes: calculation.payableMinutes, overtimeMinutes: calculation.overtimeMinutes, dailyPay: row.payType === 'hourly' ? row.rate * calculation.payableMinutes / 60 : null }; })), [rows, source, month]);
  const saveDraft = async () => { if (!canManage) return setMessage('급여 초안 저장은 최고관리자만 할 수 있습니다.'); setBusy(true); try { await savePayrollDraft({ organizationId, settlementMonth: month, lines: rows.map(row => { const details = payrollDetails.filter(item => item.name === row.name); const scheduledMinutes = details.reduce((sum,item)=>sum+item.scheduledMinutes,0); const overtimeMinutes = details.reduce((sum,item)=>sum+item.overtimeMinutes,0); const paidBreakDays = details.filter(item=>item.breakPaid&&item.breakMinutes).length; return { staff_id: row.staffId, pay_type: row.payType, applied_rate: row.rate, scheduled_minutes: scheduledMinutes, worked_minutes: row.workedMinutes, completed_work_days: row.completedDays, approved_leave_days: row.leaveDays, base_pay: row.basePay, estimated_total: row.basePay, calculation_note: row.payType === 'hourly' ? `실제 출퇴근 ${formatHours(row.workedMinutes)} · 초과근무 ${formatHours(overtimeMinutes)} · 유급 휴게 ${paidBreakDays}일 · 스케줄별 휴게 처리 및 반올림 적용` : row.payType === 'daily' ? '퇴근 완료 일수 기준 · 날짜별 초과근무 상세 별도 제공' : row.payType === 'annual' ? '등록 연봉 계약의 월 환산 기준(날짜별 근태 상세 별도 제공)' : '등록 월급 계약 기준(날짜별 근태 상세 별도 제공)' }; }) }); setMessage(`${month} 급여 초안을 저장했어요.`); refresh(); } catch (error) { setMessage(error.message || '급여 초안을 저장하지 못했습니다.'); } finally { setBusy(false); } };
  const saveContract = async event => { event.preventDefault(); if (!canManage) return setMessage('급여 계약 변경은 최고관리자만 할 수 있습니다.'); const form = new FormData(event.currentTarget); const payType = form.get('payType'); const rate = parseMoney(form.get('rate')); setBusy(true); try { await savePayrollContract({ organization_id: organizationId, staff_id: form.get('staffId'), pay_type: payType, hourly_wage: payType === 'hourly' ? rate : null, daily_wage: payType === 'daily' ? rate : null, monthly_salary: payType === 'monthly' ? rate : null, annual_salary: payType === 'annual' ? rate : null, effective_from: form.get('effectiveFrom'), memo: form.get('memo') || null }); event.currentTarget.reset(); setMessage('급여 계약 이력을 저장했어요.'); refresh(); } catch (error) { setMessage(error.message || '급여 계약을 저장하지 못했습니다.'); } finally { setBusy(false); } };
  const downloadCsv = () => { const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`; const summary = ['[직원별 급여 요약]','직원,급여 형태,적용 단가,급여시간,완료 근무일,승인 휴가,급여 초안', ...rows.map(row => [row.name,row.payType,Math.round(row.rate),formatHours(row.workedMinutes),row.completedDays,row.leaveDays,Math.round(row.estimatedTotal)].map(quote).join(','))]; const details = ['','[날짜별 근태·초과근무 상세]','직원,날짜,근무 형태,스케줄 시간,실제 출퇴근,실제 체류시간,스케줄 시간,휴게시간,휴게 급여 처리,실제 차감 휴게,급여 계산시간,초과근무,일별 시급 급여', ...payrollDetails.map(item => [item.name,item.date,item.shiftName,item.scheduledTime,item.actualTime,formatHours(item.grossMinutes),formatHours(item.scheduledMinutes),formatHours(item.breakMinutes),item.breakPaid?'급여 포함':'급여 미포함',formatHours(item.deductedBreakMinutes),formatHours(item.payableMinutes),item.overtimeMinutes?formatHours(item.overtimeMinutes):'-',item.dailyPay===null?'-':Math.round(item.dailyPay)].map(quote).join(','))]; const csv = [...summary,...details].join('\n'); const href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' })); const link = document.createElement('a'); link.href = href; link.download = `timefit-payroll-statement-${month}.csv`; link.click(); URL.revokeObjectURL(href); };
  return <>
<div className="page-title">
<div>
<p>계약 이력과 실제 근태 기준</p>
<h1>급여 관리</h1>
<span>급여 초안은 검토용이며 세금·공제 확정 전 금액입니다.</span>
</div>
</div>
<section className="card full-card">
<div className="card-title">
<div>
<h2>{canManage ? '급여 초안 생성' : '급여 초안 조회'}</h2>
<p>{canManage ? '선택 월의 실제 퇴근 완료 기록과 적용 중인 계약 단가를 스냅샷으로 저장합니다.' : '저장된 급여 초안과 실제 근태 기준 예상액을 조회합니다. 이 화면에서는 변경할 수 없습니다.'}</p>
</div>
</div>
<div className="settings-input-grid">
<label>정산 월<input type="month" value={month} onChange={event => setMonth(event.target.value)}/>
</label>
<div>
<b>현재 상태</b>
<p className="settings-help">{workspace.draft ? `초안 저장됨${draftUpdatedLabel ? ` · ${draftUpdatedLabel} 기준` : ''}` : '저장된 초안 없음'}</p>
</div>
</div>{workspace.draft && <div className={`payroll-snapshot-notice ${draftNeedsRefresh ? 'stale' : ''}`}>
<b>{draftNeedsRefresh ? '새 근태·계약 반영이 필요해요' : '저장된 초안을 표시하고 있어요'}</b>
<span>{draftNeedsRefresh ? `현재 계산 예상액은 ${formatMoney(liveTotal)}입니다. ${canManage ? '초안을 다시 저장하면 최신 근태와 계약 단가가 반영됩니다.' : '최고관리자에게 초안 갱신을 요청해 주세요.'}` : '저장 이후의 근태·계약 변경은 초안을 다시 저장해야 반영됩니다.'}</span>
</div>}<div className="form-actions">
{canManage ? <button className="submit" disabled={busy || loading || !rows.length} onClick={saveDraft}>{busy ? '저장 중…' : workspace.draft ? '이 달 급여 초안 다시 저장' : '이 달 급여 초안 저장'}</button> : <span className="payroll-readonly-note">지출 · 증빙에서는 조회만 가능해요.{onOpenPayroll && <button type="button" className="outline" onClick={onOpenPayroll}>급여 관리로 이동</button>}</span>}
<button className="outline" disabled={!rows.length} onClick={downloadCsv}>CSV 다운로드</button>
<button className="outline" disabled={!rows.length} onClick={()=>openPayrollPrintView({rows,details:payrollDetails,month})}>전체 명세 PDF</button>
</div>
</section>
{canManage && <section className="card full-card">
<div className="card-title">
<div>
<h2>급여 계약 이력 추가</h2>
<p>직접 등록한 직원은 최초 계약이 자동 생성됩니다. 단가 변경일은 이력으로 추가해 주세요.</p>
</div>
</div>
<form className="settings-form" onSubmit={saveContract}>
<div className="settings-input-grid">
<label>직원<select name="staffId" required defaultValue="">
<option value="" disabled>직원을 선택해 주세요</option>{source?.staff.map(staff => <option value={staff.id} key={staff.id}>{staff.account?.display_name || staff.display_name || '직원'}</option>)}</select>
</label>
<label>적용 시작일<input name="effectiveFrom" type="date" defaultValue={`${month}-01`} required/>
</label>
<label>급여 형태<select name="payType" defaultValue="hourly">
<option value="hourly">시급제</option>
<option value="daily">일급제</option>
<option value="monthly">월급제</option>
<option value="annual">연봉제</option>
</select>
</label>
<label>단가<input name="rate" type="number" min="1" placeholder="원 단위" required/>
</label>
</div>
<label>변경 사유 (선택)<input name="memo" placeholder="예: 9월 계약 갱신"/>
</label>
<button className="outline" disabled={busy || loading}>{busy ? '저장 중…' : '계약 이력 저장'}</button>
</form>
</section>}
<section className="pay-cards">
<div className="card">
<p>{workspace.draft ? '저장된 초안 인건비' : '예상 총 인건비'}</p>
<strong>{formatMoney(total)}</strong>
<span>{workspace.draft ? '저장된 세전 스냅샷' : '세전 예상액'}</span>
</div>
<div className="card">
<p>급여 산정 대상</p>
<strong>{rows.length}<small>명</small>
</strong>
<span>실제 근태와 계약 기준</span>
</div>
<div className="card">
<p>근태 확인 필요</p>
<strong>{rows.filter(row => !row.hasContract || (row.payType !== 'monthly' && row.payType !== 'annual' && !row.completedDays)).length}<small>명</small>
</strong>
<span>계약 또는 퇴근 기록 확인</span>
</div>
</section>
<section className="card full-card">
<div className="card-title">
<div>
<h2>직원별 급여 초안</h2>
<p>시급은 운영 설정의 반올림 단위가 적용된 실제 퇴근 완료 시간을 사용합니다.</p>
</div>
</div>{loading ? <LoadingBar label="급여 계약과 근태를 불러오는 중…"/> : rows.length ? rows.map(row => <div className="salary-row clickable-row" key={row.staffId} onClick={() => { const employee = employees.find(item => item.id === row.staffId); if (employee) onSelect(employee); }}>
<span className="grow">
<b>{row.name}</b>
<small>{row.payType === 'monthly' ? '월급제' : row.payType === 'annual' ? `연봉제 · 월 환산 ${formatMoney(row.rate / 12)}` : row.payType === 'daily' ? `일급제 · 완료 ${row.completedDays}일` : `시급제 · 실근무 ${formatHours(row.workedMinutes)}`} · 적용 단가 {formatMoney(row.rate)}</small>
</span>
<span>휴가 {row.leaveDays}일</span>
<span className="payroll-row-amount">
<strong>{formatMoney(row.estimatedTotal)}</strong>{draftNeedsRefresh && row.savedEstimatedTotal !== null && Math.round(row.savedEstimatedTotal) !== Math.round(row.basePay) && <small>현재 계산 {formatMoney(row.basePay)}</small>}</span>
<Chip type={row.hasContract ? 'green' : 'orange'}>{row.hasContract ? '계약 적용' : '계약 확인 필요'}</Chip>
<button type="button" className="outline payroll-pdf-button" onClick={event=>{event.stopPropagation();openPayrollPrintView({rows,details:payrollDetails,month,employeeId:row.staffId});}}>개별 PDF</button>
</div>) : <div className="empty-schedule">
<b>급여 산정 대상 직원이 없어요.</b>
<span>직원을 등록하고 계약 단가를 입력해 주세요.</span>
</div>}</section>{message && <NoticeModal message={message} tone={/못|확인/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</>;
}

function SalesAnalytics({ organizationId, canSyncSales = false }) {
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [rangeMode, setRangeMode] = useState('month'); const [customFrom, setCustomFrom] = useState(`${todayKey.slice(0, 7)}-01`); const [customTo, setCustomTo] = useState(todayKey);
  const range = useMemo(() => { if (rangeMode === 'custom') return { from: customFrom, to: customTo }; const [year, monthNumber] = month.split('-').map(Number); const lastDay = new Date(year, monthNumber, 0).getDate(); return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }; }, [month, rangeMode, customFrom, customTo]);
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [syncing, setSyncing] = useState(false); const [error, setError] = useState(''); const [cachedAt, setCachedAt] = useState(null);
  const [laborReport, setLaborReport] = useState(null);
  useEffect(() => {
    let active = true;
    setLaborReport(null);
    if (organizationId && range.from && range.to) {
      loadSalesLaborSummary(organizationId, range)
        .then(report => { if (active) setLaborReport(report); })
        .catch(() => { if (active) setLaborReport(null); });
    }
    return () => { active = false; };
  }, [organizationId, range.from, range.to]);
  const [menuQuery, setMenuQuery] = useState(''); const [menuCategory, setMenuCategory] = useState('전체'); const [menuSort, setMenuSort] = useState('sales'); const [expandedMenu, setExpandedMenu] = useState('');
  const refresh = ({ force = false } = {}) => {
    if (!organizationId) return;
    const cached = getCachedOrganizationSalesDashboard(organizationId, range);
    if (cached && !force) {
      setData(cached.data); setCachedAt(cached.cachedAt); setError(''); setLoading(false);
      if (cached.isFresh) return;
    }
    if (cached || data) setRefreshing(true); else setLoading(true);
    setError('');
    loadOrganizationSalesDashboard(organizationId, range, { force }).then(next => {
      setData(next); setCachedAt(Date.now());
    }).catch(nextError => {
      setError(nextError.message || '매출 데이터를 불러오지 못했습니다.');
    }).finally(() => { setLoading(false); setRefreshing(false); });
  };
  useEffect(() => { setData(null); setCachedAt(null); setLoading(true); refresh(); }, [organizationId, range.from, range.to]);
  const summary = data?.summary || {}; const connection = data?.connection; const syncError = data?.syncState?.last_sync_error || connection?.last_error || ''; const initialSyncPending = Boolean(connection?.sync_enabled && !connection?.last_synced_at);
  const menuSales = data?.menuSales || [];
  const menuCategories = useMemo(() => ['전체', ...new Set(menuSales.map(item => item.category_name || '미분류'))], [menuSales]);
  const visibleMenus = useMemo(() => menuSales.filter(item => (menuCategory === '전체' || (item.category_name || '미분류') === menuCategory) && (!menuQuery.trim() || `${item.menu_name || ''} ${item.menu_code || ''}`.toLowerCase().includes(menuQuery.trim().toLowerCase()))).sort((a, b) => menuSort === 'quantity' ? Number(b.sold_quantity) - Number(a.sold_quantity) : menuSort === 'orders' ? Number(b.order_count) - Number(a.order_count) : Number(b.gross_sales_amount) - Number(a.gross_sales_amount)), [menuSales, menuCategory, menuQuery, menuSort]);
  const menuTotals = useMemo(() => menuSales.reduce((result, item) => ({ quantity: result.quantity + Number(item.sold_quantity || 0), sales: result.sales + Number(item.gross_sales_amount || 0) }), { quantity: 0, sales: 0 }), [menuSales]);
  const syncNow = async () => { setSyncing(true); setError(''); try { await syncOrganizationSales(organizationId, { mode: 'range', ...range }); await refresh({ force: true }); window.dispatchEvent(new CustomEvent('timefit-sales-sync-complete', { detail: { organizationId, ...range } })); } catch (nextError) { setError(nextError.message || '매출 동기화를 완료하지 못했습니다.'); } finally { setSyncing(false); } };
  const updatedLabel = cachedAt ? `화면 데이터 ${new Date(cachedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준` : '';
  return <><div className="page-title"><div><p>사업장별 Toss Place 월 매출 연동</p><h1>매출 분석</h1><span>{refreshing ? '기존 데이터를 유지하며 최신 내역을 확인하고 있어요.' : updatedLabel || '월을 선택해 주문·완료 매출·취소 현황을 확인하세요.'}</span></div><div className="sales-page-actions period-sales-actions"><div className="period-mode-tabs"><button className={rangeMode === 'month' ? 'active' : ''} onClick={() => setRangeMode('month')}>월별</button><button className={rangeMode === 'custom' ? 'active' : ''} onClick={() => setRangeMode('custom')}>기간 직접 선택</button></div>{rangeMode === 'month' ? <label>조회 월<input aria-label="매출 조회 월" type="month" value={month} max={todayKey.slice(0, 7)} onChange={event => setMonth(event.target.value)}/></label> : <><label>시작일<input aria-label="매출 시작일" type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)}/></label><label>종료일<input aria-label="매출 종료일" type="date" min={customFrom} value={customTo} onChange={event => setCustomTo(event.target.value)}/></label></>}<button className="outline" onClick={syncNow} disabled={loading || refreshing || syncing || !canSyncSales} title={!canSyncSales ? "매출 수동 동기화 권한이 필요합니다." : undefined}>{syncing ? `${range.from} ~ ${range.to} 동기화 중…` : 'Toss 주문 가져오기'}</button><button className="outline" onClick={() => refresh({ force: true })} disabled={loading || refreshing || syncing}>{refreshing ? '화면 조회 중…' : loading ? '불러오는 중…' : '화면 다시 조회'}</button></div></div>{loading && !data ? <LoadingBar label="매출 데이터를 불러오는 중…"/> : error && !data ? <section className="card full-card empty-schedule"><b>매출 데이터를 불러오지 못했어요.</b><span>{error}</span><button className="outline" onClick={() => refresh({ force: true })}>다시 시도</button></section> : !connection ? <section className="card full-card empty-schedule"><b>Toss Place 연결이 필요해요.</b><span>운영 설정에서 서비스 ID와 서비스 코드를 등록한 뒤 매출 동기화를 활성화해 주세요.</span></section> : <>{initialSyncPending ? <div className="sales-sync-pending" role="status"><i/><div><b>{syncing ? 'Toss 주문 데이터를 동기화하고 있어요' : '초기 매출 데이터를 불러올 준비가 됐어요'}</b><span>{syncing ? '주문을 저장하고 일별 매출 집계를 갱신합니다.' : '지금 동기화를 누르거나 다음 자동 동기화를 기다리면 매출이 표시됩니다.'}</span></div></div> : null}{error ? <p className="settings-help">최신 데이터를 확인하지 못해 마지막으로 불러온 결과를 표시합니다. {error}</p> : null}<section className="pay-cards"><div className="card"><p>사업장 전체 인건비</p><strong>{laborReport ? formatMoney(Number(laborReport.laborCost) || 0) : '조회 불가'}</strong><span>부서 범위와 무관한 전체 급여 추정 합계 · 직원별 급여는 별도 권한</span></div><div className="card"><p>완료 매출</p><strong>{formatMoney(Number(summary.completed_amount) || 0)}</strong><span>{connection.display_name} · 최근 동기화 {connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString('ko-KR') : '초기 동기화 준비 중'}</span></div><div className="card"><p>전체 주문</p><strong>{Number(summary.order_count) || 0}<small>건</small></strong><span>완료 {Number(summary.completed_order_count) || 0}건</span></div><div className="card"><p>취소 주문</p><strong>{Number(summary.cancelled_count) || 0}<small>건</small></strong><span>{connection.connection_status === 'connected' ? '연결 정상' : '연결 확인 필요'}</span></div></section><section className="card full-card menu-sales-card"><div className="card-title"><div><h2>메뉴별 판매 상세</h2><p>완료 주문의 메뉴 수량과 옵션 포함 판매액을 집계합니다.</p></div><Chip type="green">총 {menuTotals.quantity.toLocaleString('ko-KR')}개</Chip></div><div className="menu-sales-tools"><label className="grow">메뉴 검색<input value={menuQuery} onChange={event => setMenuQuery(event.target.value)} placeholder="메뉴명 또는 코드"/></label><label>카테고리<select value={menuCategory} onChange={event => setMenuCategory(event.target.value)}>{menuCategories.map(category => <option key={category}>{category}</option>)}</select></label><label>정렬<select value={menuSort} onChange={event => setMenuSort(event.target.value)}><option value="sales">판매액순</option><option value="quantity">판매수량순</option><option value="orders">주문수순</option></select></label></div>{visibleMenus.length ? <div className="menu-sales-table"><div className="menu-sales-head"><span>메뉴·카테고리</span><span>판매 수량</span><span>주문 수</span><span>평균 판매가</span><span>판매액·비중</span></div>{visibleMenus.map((menu, index) => { const key = `${menu.menu_code || ''}:${menu.menu_name}`; const share = menuTotals.sales ? Number(menu.gross_sales_amount || 0) / menuTotals.sales * 100 : 0; return <React.Fragment key={key}><button type="button" className="menu-sales-row" onClick={() => setExpandedMenu(expandedMenu === key ? '' : key)} aria-expanded={expandedMenu === key}><span><b><i>{index + 1}</i>{menu.menu_name}</b><small>{menu.category_name || '미분류'}{menu.menu_code ? ` · ${menu.menu_code}` : ''}</small></span><strong>{Number(menu.sold_quantity || 0).toLocaleString('ko-KR')}개</strong><span>{Number(menu.order_count || 0).toLocaleString('ko-KR')}건</span><span>{formatMoney(Number(menu.average_item_amount) || 0)}</span><span className="menu-sales-amount"><b>{formatMoney(Number(menu.gross_sales_amount) || 0)}</b><small>{share.toFixed(1)}%</small></span></button>{expandedMenu === key && <div className="menu-sales-detail"><div><span>주문당 판매 수량</span><b>{Number(menu.order_count) ? (Number(menu.sold_quantity) / Number(menu.order_count)).toFixed(1) : '0'}개</b></div><div><span>메뉴 매출 기여도</span><b>{share.toFixed(2)}%</b></div><div><span>메뉴 평균 판매가</span><b>{formatMoney(Number(menu.average_item_amount) || 0)}</b></div><div className="menu-share-bar"><i style={{width:`${Math.min(100, share)}%`}}/></div></div>}</React.Fragment>; })}</div> : <div className="empty-schedule"><b>{menuSales.length ? '검색 조건에 맞는 메뉴가 없어요.' : '메뉴별 판매 데이터가 없어요.'}</b><span>{menuSales.length ? '검색어 또는 카테고리를 변경해 주세요.' : '선택 월 동기화 후 Toss 주문의 메뉴 항목이 표시됩니다.'}</span></div>}</section><section className="card full-card"><div className="card-title"><div><h2>최근 주문</h2><p>{syncError ? `최근 동기화 오류: ${syncError}` : '이 사업장에 연결된 Toss Place 주문만 표시합니다.'}</p></div><Chip type={connection.sync_enabled ? 'green' : 'orange'}>{syncing ? '동기화 중' : connection.sync_enabled ? '자동 동기화 사용' : '동기화 중지'}</Chip></div>{data.recentOrders?.length ? data.recentOrders.map(order => <div className="salary-row" key={order.order_id}><span className="grow"><b>{order.order_id}</b><small>{order.ordered_at ? new Date(order.ordered_at).toLocaleString('ko-KR') : '-'}</small></span><span>{order.source || '-'}</span><strong>{formatMoney(Number(order.total_amount) || 0)}</strong><Chip type={String(order.state || '').toLowerCase().includes('cancel') ? 'orange' : 'green'}>{order.state || '완료'}</Chip></div>) : <div className="empty-schedule"><b>{syncing ? 'Toss 주문을 저장하고 있어요.' : initialSyncPending ? '아직 동기화된 주문이 없어요.' : '동기화된 주문이 없어요.'}</b><span>{syncing ? '완료되면 이 화면에 주문·매출 집계가 자동으로 반영됩니다.' : initialSyncPending ? '지금 동기화를 눌러 첫 주문 데이터를 불러올 수 있어요.' : '연결 정보를 저장한 후 다음 동기화 또는 수동 동기화를 실행해 주세요.'}</span></div>}</section></>}</>;
}

function CorporateCards({ organizationId }) {
  const [cards, setCards] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const range = useMemo(() => { const [year, monthNumber] = month.split('-').map(Number); return { from: `${month}-01`, to: `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}` }; }, [month]);
  const refresh = async () => { setLoading(true); try { const [nextCards, nextTransactions] = await Promise.all([loadCorporateCards(organizationId), loadCardTransactions(organizationId, range.from, range.to)]); setCards(nextCards); setTransactions(nextTransactions); } catch (error) { setMessage(error.message || '법인카드 정보를 불러오지 못했습니다.'); } finally { setLoading(false); } };
  useEffect(() => { if (organizationId) refresh(); }, [organizationId, month]);
  const chooseGranterFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseGranterCardFile(file);
      if (!parsed.rows.length) throw new Error('파일에서 체크카드·신용카드 거래를 찾지 못했습니다. 전체 결제내역 엑셀인지 확인해 주세요.');
      setImportPreview({ ...parsed, fileName: file.name });
    } catch (error) { setImportPreview(null); setMessage(error.message || '결제내역 엑셀을 읽지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const importGranterFile = async () => {
    if (!importPreview?.rows?.length) return;
    setBusy(true);
    try {
      let workingCards = [...cards]; let imported = 0; let duplicates = 0;
      const groups = Object.groupBy ? Object.groupBy(importPreview.rows, row => `${row.accountName}|${row.last4}`) : importPreview.rows.reduce((result, row) => { const key = `${row.accountName}|${row.last4}`; (result[key] ||= []).push(row); return result; }, {});
      for (const rows of Object.values(groups)) {
        const sample = rows[0];
        let card = workingCards.find(item => item.provider === 'granter_file' && item.provider_card_id === `granter:${sample.accountName}`);
        if (!card) {
          card = await ensureImportedCorporateCard({ organizationId, issuer: sample.issuer, nickname: `결제내역 체크카드 출금계좌 · ${sample.accountName}`, last4: sample.last4, sourceKey: sample.accountName });
          workingCards = [card, ...workingCards];
        }
        for (let offset = 0; offset < rows.length; offset += 500) {
          const result = await importCardTransactions({ organizationId, corporateCardId: card.id, rows: rows.slice(offset, offset + 500) });
          imported += Number(result.imported || 0); duplicates += Number(result.duplicates || 0);
        }
      }
      setCards(workingCards); setImportPreview(null); await refresh();
      setMessage(`${imported}건을 가져왔어요.${duplicates ? ` 이미 등록된 ${duplicates}건은 제외했어요.` : ''}`);
    } catch (error) { setMessage(error.message || '결제내역을 가져오지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const removeCard = async card => { if (!window.confirm(`“${card.nickname.replace(/^그랜터/, '결제내역')}” 카드를 목록에서 숨길까요? 과거 거래와 결산 자료는 유지됩니다.`)) return; setBusy(true); try { await disconnectCorporateCard(card.id); setCards(items => items.filter(item => item.id !== card.id)); setMessage('카드를 목록에서 숨겼어요. 과거 거래와 결산 자료는 유지됩니다.'); } catch (error) { setMessage(error.message || '카드를 숨기지 못했습니다.'); } finally { setBusy(false); } };
  const total = transactions.reduce((sum, item) => sum + Number(item.amount), 0);
  return <><section className="card full-card corporate-card-workspace">
    <div className="card-title"><div><h2>결제내역 가져오기</h2><p>전체 결제내역 엑셀 파일을 올리면 거래구분이 체크카드·신용카드인 내역만 선별합니다.</p></div><label className={`cta card-csv-button ${busy ? 'disabled' : ''}`}>{busy ? '파일 확인 중…' : '결제내역 엑셀 선택'}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={chooseGranterFile}/></label></div>
    <div className="card-connection-panel granter-import-guide"><div><b>가져오는 방법</b><p>전체 결제내역에서 엑셀 파일을 내려받아 선택하세요. 외부 카드 API 연결은 현재 보류 상태입니다.</p></div><ol><li><strong>1</strong><span>결제내역 엑셀 다운로드</span></li><li><strong>2</strong><span>TimeFit 파일 선택</span></li><li><strong>3</strong><span>카드 거래 확인</span></li><li><strong>4</strong><span>중복 제외 저장</span></li></ol></div>
    {importPreview && <div className="granter-import-preview"><div><b>{importPreview.fileName}</b><span>카드 거래 {importPreview.rows.length}건 · 일반 입출금 {importPreview.skipped.nonCard}건 제외 · 카드/계좌 {new Set(importPreview.rows.map(row => `${row.accountName}|${row.last4}`)).size}개</span></div><div className="card-title-actions"><button className="outline" disabled={busy} onClick={() => setImportPreview(null)}>취소</button><button className="cta" disabled={busy} onClick={importGranterFile}>{busy ? '가져오는 중…' : `${importPreview.rows.length}건 가져오기`}</button></div></div>}
    <div className="corporate-card-summary"><label>조회 월<input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label><div><span>파일 등록 카드</span><strong>{cards.length}개</strong></div><div><span>카드내역</span><strong>{transactions.length}건</strong></div><div><span>순 이용금액</span><strong>{formatMoney(total)}</strong></div></div>
    {loading ? <LoadingBar label="법인카드를 불러오는 중…"/> : cards.length ? <div className="corporate-card-list">{cards.map(card => <article className={`corporate-card-item ${card.status}`} key={card.id}><div className="corporate-card-brand"><span>{card.issuer.slice(0, 1)}</span><div><b>{card.nickname.replace(/^그랜터/, '결제내역')}</b><small>{card.issuer} · •••• {card.last4}</small></div></div><div className="corporate-card-meta"><Chip type={card.provider === 'granter_file' ? 'green' : 'gray'}>{card.provider === 'granter_file' ? '결제내역 파일' : '기존 연결'}</Chip><span>{card.holder?.display_name || '공용 카드'}</span><small>{card.last_synced_at ? `최근 가져오기 ${new Date(card.last_synced_at).toLocaleString('ko-KR')}` : card.provider === 'granter_file' ? '결제내역 엑셀에서 생성됨' : '외부 API 보류'}</small></div><div className="corporate-card-actions"><button className="outline danger-outline" disabled={busy} onClick={() => removeCard(card)}>목록에서 숨기기</button></div></article>)}</div> : <div className="empty-schedule"><b>가져온 카드내역이 없어요.</b><span>전체 결제내역 엑셀을 선택하면 출금계좌와 카드 사용내역이 함께 등록됩니다.</span></div>}
    <div className="corporate-transactions"><div className="card-title"><div><h3>{month} 가져온 카드내역</h3><p>같은 계좌·일시·금액·사용처의 거래는 파일을 다시 올려도 중복 저장되지 않습니다.</p></div></div>{transactions.length ? transactions.map(item => <div className="salary-row" key={item.id}><span className="grow"><b>{item.merchant_name}</b><small>{new Date(item.approved_at).toLocaleString('ko-KR')} · {item.card?.nickname?.replace(/^그랜터/, '결제내역')} •••• {item.card?.last4}</small></span><strong className={item.transaction_type === 'cancellation' ? 'transaction-cancelled' : ''}>{item.transaction_type === 'cancellation' ? '-' : ''}{formatMoney(item.amount)}</strong><Chip type={item.transaction_type === 'cancellation' ? 'orange' : 'green'}>{item.transaction_type === 'cancellation' ? '취소·환불' : '사용'}</Chip></div>) : <div className="empty-inline">이 달에 가져온 카드 내역이 없습니다.</div>}</div>
    {message && <NoticeModal message={message} tone={/못|확인|없|실패/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section><BankConnectionWorkspace/></>;
}

function LegacyCorporateCards({ organizationId, employees = [] }) {
  const [cards, setCards] = useState([]); const [transactions, setTransactions] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [showForm, setShowForm] = useState(false); const [showConnection, setShowConnection] = useState(false); const [month, setMonth] = useState(todayKey.slice(0, 7)); const [selectedCardId, setSelectedCardId] = useState('');
  const range = useMemo(() => { const [year, monthNumber] = month.split('-').map(Number); return { from: `${month}-01`, to: `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}` }; }, [month]);
  const refresh = async () => { setLoading(true); try { const [nextCards, nextTransactions] = await Promise.all([loadCorporateCards(organizationId), loadCardTransactions(organizationId, range.from, range.to)]); setCards(nextCards); setTransactions(nextTransactions); setSelectedCardId(current => current || nextCards[0]?.id || ''); } catch (error) { setMessage(error.message || '법인카드 정보를 불러오지 못했습니다.'); } finally { setLoading(false); } };
  useEffect(() => { if (!organizationId) return undefined; refresh(); const handleSync = () => refresh(); window.addEventListener('timefit-card-sync-complete', handleSync); return () => window.removeEventListener('timefit-card-sync-complete', handleSync); }, [organizationId, month]);
  const addCard = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { const card = await createCorporateCard({ organizationId, issuer: form.get('issuer'), nickname: form.get('nickname'), last4: form.get('last4'), holderStaffId: form.get('holderStaffId') }); setCards(items => [card, ...items]); setSelectedCardId(card.id); setShowForm(false); event.currentTarget.reset(); setMessage('법인카드를 등록했어요. 카드번호 전체와 CVC는 저장하지 않습니다.'); } catch (error) { setMessage(error.message || '법인카드를 등록하지 못했습니다.'); } finally { setBusy(false); } };
  const toggleCard = async card => { setBusy(true); try { const next = await updateCorporateCard(card.id, { status: card.status === 'active' ? 'paused' : 'active' }); setCards(items => items.map(item => item.id === next.id ? next : item)); setMessage(next.status === 'active' ? '카드 사용 상태를 활성화했어요.' : '카드 내역 수집을 일시 정지했어요.'); } catch (error) { setMessage(error.message || '카드 상태를 변경하지 못했습니다.'); } finally { setBusy(false); } };
  const removeCard = async card => { if (!window.confirm(`“${card.nickname}” 카드 연결을 해제할까요? 과거 승인내역과 결산 자료는 안전하게 유지됩니다.`)) return; setBusy(true); try { await disconnectCorporateCard(card.id); setCards(items => items.filter(item => item.id !== card.id)); setMessage('카드 연결을 해제했어요. 과거 거래와 결산 자료는 유지됩니다.'); } catch (error) { setMessage(error.message || '카드 연결을 해제하지 못했습니다.'); } finally { setBusy(false); } };
  const parseCsvLine = line => { const values = []; let value = ''; let quoted = false; for (let index = 0; index < line.length; index += 1) { const character = line[index]; if (character === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; } else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; } else value += character; } values.push(value.trim()); return values; };
  const importCsv = async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || !selectedCardId) return; setBusy(true); try { const lines = (await file.text()).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean); if (lines.length < 2) throw new Error('헤더와 승인내역이 포함된 CSV 파일을 선택해 주세요.'); const headers = parseCsvLine(lines[0]).map(value => value.toLowerCase().replace(/[\s_-]/g, '')); const valueOf = (row, names) => { const index = headers.findIndex(header => names.includes(header)); return index >= 0 ? row[index] : ''; }; const rows = lines.slice(1).map(parseCsvLine).map((row, index) => { const date = valueOf(row, ['승인일시','거래일시','일시','date','approvedat']); const merchantName = valueOf(row, ['가맹점','사용처','거래처','merchant','merchantname']); const amount = parseMoney(valueOf(row, ['금액','이용금액','승인금액','amount'])); const approvalNumber = valueOf(row, ['승인번호','approvalnumber']); const typeText = valueOf(row, ['구분','거래구분','type']); if (!date || !merchantName || !amount) throw new Error(`${index + 2}행의 승인일시, 사용처 또는 금액을 확인해 주세요.`); const approvedAt = new Date(date.replace(/\./g, '-').replace(' ', 'T')); if (Number.isNaN(approvedAt.getTime())) throw new Error(`${index + 2}행의 승인일시 형식을 확인해 주세요.`); const transactionType = /취소|cancel/i.test(typeText) ? 'cancellation' : 'approval'; return { approvedAt: approvedAt.toISOString(), merchantName, amount, approvalNumber, transactionType, sourceTransactionId: approvalNumber ? `${approvalNumber}-${approvedAt.toISOString()}-${amount}-${transactionType}` : `${approvedAt.toISOString()}-${amount}-${transactionType}-${merchantName}` }; }); const result = await importCardTransactions({ organizationId, corporateCardId: selectedCardId, rows }); setMessage(`${result.imported}건을 가져왔어요.${result.duplicates ? ` 중복 ${result.duplicates}건은 제외했어요.` : ''}`); await refresh(); } catch (error) { setMessage(error.message || '카드 승인내역을 가져오지 못했습니다.'); } finally { setBusy(false); } };
  const total = transactions.reduce((sum, item) => sum + Number(item.amount), 0);
  const transactionLabel = type => type === 'cancellation' ? '전체 취소' : type === 'partial_cancellation' ? '부분 취소' : type === 'acquired' ? '매입 완료' : type === 'billed' ? '청구 확정' : '승인';
  return <section className="card full-card corporate-card-workspace"><div className="card-title"><div><h2>법인카드</h2><p>카드사를 연결하면 보유카드와 승인·취소·매입내역을 자동으로 가져옵니다.</p></div><div className="card-title-actions"><button className="cta" onClick={() => { setShowConnection(value => !value); setShowForm(false); }}>{showConnection ? '연결 안내 닫기' : '카드사 자동 연결'}</button><button className="outline" onClick={() => { setShowForm(value => !value); setShowConnection(false); }}>{showForm ? '등록 닫기' : '카드 수동 등록'}</button></div></div>{showConnection && <div className="card-connection-panel"><div><b>카드사 자동 연결</b><p>사업자 인증 후 보유카드를 불러오고 최근 90일 승인·취소·매입내역을 자동 대조합니다.</p></div><ol><li><strong>1</strong><span>수집·이용 동의</span></li><li><strong>2</strong><span>사업자·카드사 인증</span></li><li><strong>3</strong><span>카드 선택·담당자 지정</span></li><li><strong>4</strong><span>90일 내역 자동 수집</span></li></ol><div className="connection-readiness"><Chip type="orange">연동 준비</Chip><span>하이픈 테스트베드 키를 연결하면 이 흐름에서 실제 카드 조회가 활성화됩니다.</span></div></div>}{showForm && <form className="settings-form corporate-card-form" onSubmit={addCard}><div className="settings-input-grid"><label>카드사<input name="issuer" placeholder="예: 국민카드" required/></label><label>카드 별칭<input name="nickname" placeholder="예: 매장 운영비 카드" required/></label><label>끝 4자리<input name="last4" inputMode="numeric" pattern="[0-9]{4}" maxLength="4" placeholder="1234" required/></label><label>사용 직원<select name="holderStaffId" defaultValue=""><option value="">공용 카드</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} · {employee.team}</option>)}</select></label></div><p className="settings-help">수동 등록은 CSV 폴백용입니다. 카드번호 전체, 유효기간, CVC, 비밀번호는 저장하지 않습니다.</p><button className="submit" disabled={busy}>{busy ? '등록 중…' : '수동 카드 등록'}</button></form>}<div className="corporate-card-summary"><label>조회 월<input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label><div><span>등록 카드</span><strong>{cards.length}개</strong></div><div><span>승인내역</span><strong>{transactions.length}건</strong></div><div><span>순 이용금액</span><strong>{formatMoney(total)}</strong></div></div>{loading ? <LoadingBar label="법인카드를 불러오는 중…"/> : cards.length ? <><div className="corporate-card-list">{cards.map(card => <article className={`corporate-card-item ${card.status}`} key={card.id}><div className="corporate-card-brand"><span>{card.issuer.slice(0, 1)}</span><div><b>{card.nickname}</b><small>{card.issuer} · •••• {card.last4}</small></div></div><div className="corporate-card-meta"><Chip type={card.status === 'active' ? 'green' : 'gray'}>{card.status === 'active' ? '사용 중' : '일시 정지'}</Chip><span>{card.holder?.display_name || '공용 카드'}</span><small>{card.last_synced_at ? `최근 가져오기 ${new Date(card.last_synced_at).toLocaleString('ko-KR')}` : '승인내역 없음'}</small></div><div className="corporate-card-actions"><button className="outline" disabled={busy} onClick={() => toggleCard(card)}>{card.status === 'active' ? '일시 정지' : '다시 사용'}</button><button className="outline danger-outline" disabled={busy} onClick={() => removeCard(card)}>연결 해제</button></div></article>)}</div><div className="card-import-row"><label>승인내역 카드<select value={selectedCardId} onChange={event => setSelectedCardId(event.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{card.nickname} · {card.last4}</option>)}</select></label><label className={`outline card-csv-button ${busy || !selectedCardId ? 'disabled' : ''}`}>CSV 승인내역 가져오기<input type="file" accept=".csv,text/csv" disabled={busy || !selectedCardId} onChange={importCsv}/></label><small>자동 연결 장애 중에도 CSV로 계속 운영할 수 있습니다.</small></div></> : <div className="empty-schedule"><b>연결된 법인카드가 없어요.</b><span>카드사를 연결하면 보유카드와 거래내역을 자동으로 가져옵니다.</span><button className="outline" onClick={() => setShowConnection(true)}>카드사 연결 안내 보기</button></div>}<div className="corporate-transactions"><div className="card-title"><div><h3>{month} 승인내역</h3><p>같은 승인번호·일시·금액의 내역은 다시 가져와도 중복 저장되지 않습니다.</p></div></div>{transactions.length ? transactions.map(item => <div className="salary-row" key={item.id}><span className="grow"><b>{item.merchant_name}</b><small>{new Date(item.approved_at).toLocaleString('ko-KR')} · {item.card?.nickname} •••• {item.card?.last4}{item.approval_number ? ` · 승인 ${item.approval_number}` : ''}</small></span><strong className={item.transaction_type === 'cancellation' ? 'transaction-cancelled' : ''}>{item.transaction_type === 'cancellation' ? '-' : ''}{formatMoney(item.amount)}</strong><Chip type={item.transaction_type === 'cancellation' ? 'orange' : 'green'}>{item.transaction_type === 'cancellation' ? '승인 취소' : '승인'}</Chip></div>) : <div className="empty-inline">이 달에 가져온 카드 승인내역이 없습니다.</div>}</div>{message && <NoticeModal message={message} tone={/못|확인|없|실패/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</section>;
}

function FinanceDocuments({ organizationId, employees = [] }) {
  const [documents, setDocuments] = useState([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [settlementMonth, setSettlementMonth] = useState(todayKey.slice(0, 7)); const [accountantEmail, setAccountantEmail] = useState(''); const [sales, setSales] = useState(null); const [salesError, setSalesError] = useState('');
  const monthRange = month => { const [year, monthNumber] = month.split('-').map(Number); const start = `${month}-01`; const end = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`; return { start, end }; };
  const refresh = () => { setLoading(true); Promise.all([loadFinanceDocuments(organizationId), getOrganizationSettings(organizationId)]).then(([items, settings]) => { setDocuments(items); setAccountantEmail(settings?.accountant_email || ''); }).catch(error => setMessage(error.message || '문서 목록을 불러오지 못했습니다.')).finally(() => setLoading(false)); };
  useEffect(() => { if (organizationId) refresh(); }, [organizationId]);
  useEffect(() => { const input = document.querySelector('.manager input[name="file"]'); if (!input) return; input.setAttribute('accept', 'image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.csv,.xls,.xlsx'); input.setAttribute('capture', 'environment'); }, []);
  useEffect(() => { if (!organizationId || !settlementMonth) return; const { start, end } = monthRange(settlementMonth); setSalesError(''); loadOrganizationSalesDashboard(organizationId, { from: start, to: end }).then(setSales).catch(error => { setSales(null); setSalesError(error.message || '매출 데이터를 불러오지 못했습니다.'); }); }, [organizationId, settlementMonth]);
  const upload = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get('file'); setBusy(true); try { const document = await uploadFinanceDocument({ organizationId, documentType: file?.type?.startsWith('image/') ? 'receipt' : form.get('documentType'), title: form.get('title'), file, documentDate: form.get('documentDate'), memo: form.get('memo') }); if (file?.type?.startsWith('image/')) { const result = await processReceiptDocument({ organizationId, documentId: document.id }); setMessage(result.duplicateReceipt ? `이미 처리된 영수증과 같아 기존 지출에 증빙만 추가했어요. ${result.extracted?.merchantName || ''} · ${formatMoney(result.extracted?.totalAmount || 0)}` : `영수증을 분석했어요. ${result.extracted?.merchantName || '사용처 확인 필요'} · ${formatMoney(result.extracted?.totalAmount || 0)}${result.candidates?.length ? ` · 카드 후보 ${result.candidates.length}건` : ' · 카드 후보 없음'}`); } else setMessage('정산 문서를 업로드했어요.'); event.currentTarget.reset(); refresh(); } catch (error) { setMessage(error.message || '문서를 업로드하지 못했습니다. 원본은 보관됐으니 다시 분석할 수 있습니다.'); refresh(); } finally { setBusy(false); } };
  const open = async document => { try { window.open(await openFinanceDocument(document.storage_path), '_blank', 'noopener,noreferrer'); } catch (error) { setMessage(error.message || '파일을 열지 못했습니다.'); } };
  const remove = async document => { if (!window.confirm(`“${document.title}” 문서를 삭제할까요?`)) return; setBusy(true); try { await deleteFinanceDocument(document); setDocuments(items => items.filter(item => item.id !== document.id)); setMessage('문서를 삭제했어요.'); } catch (error) { setMessage(error.message || '문서를 삭제하지 못했습니다.'); } finally { setBusy(false); } };
  const label = type => type === 'tax_invoice' ? '세금계산서' : type === 'sales_slip' ? '매출전표' : '기타 정산자료';
  const fileSize = value => value < 1024 * 1024 ? `${Math.ceil(value / 1024)}KB` : `${(value / 1024 / 1024).toFixed(1)}MB`;
  const send = async event => { event.preventDefault(); const email = accountantEmail.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) { setMessage('세무사 수신 이메일을 확인해 주세요.'); return; } setBusy(true); try { await saveOrganizationSettings({ organization_id: organizationId, accountant_email: email }); const { start, end } = monthRange(settlementMonth); const selectedDocuments = documents.filter(document => !document.document_date || (document.document_date >= start && document.document_date <= end)); await sendSettlementEmail({ organizationId, settlementMonth: `${settlementMonth}-01`, recipientEmail: email, summary: { completedAmount: Number(sales?.summary?.completed_amount || 0), completedOrders: Number(sales?.summary?.completed_order_count || 0), uploadedDocumentCount: selectedDocuments.length } }); setMessage('월말 정산 요약을 세무사 이메일로 발송했어요.'); } catch (error) { setMessage(error.message || '정산 이메일을 발송하지 못했습니다.'); } finally { setBusy(false); } };
  const { start, end } = monthRange(settlementMonth); const documentCount = documents.filter(document => !document.document_date || (document.document_date >= start && document.document_date <= end)).length;
  return <>
<section className="card full-card">
<div className="card-title">
<div>
<h2>월말 정산 전달</h2>
<p>매출 요약과 업로드 증빙 현황을 세무사에게 이메일로 전달합니다. 원본 파일은 TimeFit에서만 안전하게 열람할 수 있어요.</p>
</div>
</div>
<form className="settings-form" onSubmit={send}>
<div className="settings-input-grid">
<label>정산 월<input type="month" value={settlementMonth} onChange={event => setSettlementMonth(event.target.value)} required/>
</label>
<label>세무사 수신 이메일<input type="email" value={accountantEmail} onChange={event => setAccountantEmail(event.target.value)} placeholder="tax@example.com" required/>
</label>
</div>
<div className="pay-cards">
<div className="card">
<p>완료 매출</p>
<strong>{salesError ? '-' : formatMoney(Number(sales?.summary?.completed_amount || 0))}</strong>
<span>{salesError ? '매출 연동 확인 필요' : `완료 주문 ${Number(sales?.summary?.completed_order_count || 0)}건`}</span>
</div>
<div className="card">
<p>정산 증빙</p>
<strong>{documentCount}<small>건</small>
</strong>
<span>{settlementMonth} 기준 업로드 문서</span>
</div>
</div>
<button className="submit" disabled={busy}>{busy ? '발송 중…' : '세무사에게 정산 요약 보내기'}</button>
</form>
</section>
<section className="card full-card">
<div className="card-title">
<div>
<h2>정산 문서 업로드</h2>
<p>PDF, CSV, Excel 파일을 최대 20MB까지 업로드할 수 있어요.</p>
</div>
</div>
<form className="settings-form" onSubmit={upload}>
<div className="settings-input-grid">
<label>문서 종류<select name="documentType" defaultValue="tax_invoice">
<option value="tax_invoice">세금계산서</option>
<option value="sales_slip">매출전표</option>
<option value="other">기타 정산자료</option>
</select>
</label>
<label>문서 제목<input name="title" placeholder="예: 2026년 8월 매출전표" required/>
</label>
<label>기준일<input name="documentDate" type="date"/>
</label>
<label>파일<input name="file" type="file" accept=".pdf,.csv,.xls,.xlsx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required/>
</label>
</div>
<label>메모 (선택)<textarea name="memo" placeholder="세무사 전달 여부, 확인할 사항 등을 남겨 주세요."/>
</label>
<button className="submit" disabled={busy}>{busy ? '업로드 중…' : '정산 문서 업로드'}</button>
</form>
</section>
<section className="card full-card">
<div className="card-title">
<div>
<h2>업로드된 문서</h2>
<p>현재 사업장 관리자만 열람·삭제할 수 있습니다.</p>
</div>
</div>{loading ? <LoadingBar label="정산 문서를 불러오는 중…"/> : documents.length ? documents.map(document => <div className="salary-row" key={document.id}>
<span className="grow">
<b>{document.title}</b>
<small>{label(document.document_type)} · {document.document_date || '기준일 미입력'} · {document.file_name} · {fileSize(Number(document.file_size || 0))}{document.memo ? <>
<br/>{document.memo}</> : null}</small>
</span>
<button className="outline" disabled={busy} onClick={() => open(document)}>열기</button>
<button className="outline" disabled={busy} onClick={() => remove(document)}>삭제</button>
</div>) : <div className="empty-schedule">
<b>업로드된 정산 문서가 없어요.</b>
<span>세금계산서, 매출전표, 세무 자료를 올려 보관할 수 있어요.</span>
</div>}</section>{message && <NoticeModal message={message} tone={/못|확인|이하/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</>;
}

function ExpenseEvidenceWorkspace({ organizationId, employees = [], canManageExpenses = false, canViewPayroll = false, onSelectEmployee, onOpenPayroll }) {
  const [section, setSection] = useState('dashboard');
  const [ledgerDate, setLedgerDate] = useState('');
  const [exceptionReturn, setExceptionReturn] = useState(null);
  const sections = [['dashboard', '대시보드'], ['ledger', '지출 원장'], ['evidence', '증빙 검토'], ['cards', '법인카드'], ...(canViewPayroll ? [['labor', '인건비 · 급여']] : []), ['settlement', '정산 문서']];
  const descriptions = {
    dashboard: '운영손익과 증빙 누락, 카드 대사 상태를 먼저 확인하세요.',
    ledger: '카드와 영수증이 합쳐진 최종 지출을 조회하고 원천까지 추적하세요.',
    evidence: '자동 매칭되지 않았거나 확인이 필요한 증빙만 처리하세요.',
    cards: '결제내역 엑셀로 카드 사용·취소 내역을 가져오세요.',
    labor: '운영순익에 반영되는 실제 근무 기준 인건비와 급여 초안을 확인하세요.',
    settlement: '세금계산서와 매출전표를 보관하고 월말 정산 자료를 전달하세요.',
  };
  return <div className="expense-workspace">
    <div className="page-title expense-workspace-title"><div><p>독립 비용관리 워크스페이스</p><h1>지출 · 증빙</h1><span>{descriptions[section]}</span></div></div>
    <nav className="expense-workspace-tabs" aria-label="지출·증빙 메뉴">
      {sections.map(([id, label]) => <button type="button" key={id} className={section === id ? 'active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => { if (id === 'ledger') setLedgerDate(''); setExceptionReturn(null); setSection(id); }}>{label}</button>)}
    </nav>
    {exceptionReturn && section !== 'dashboard' && <div className="expense-exception-return"><span>예외 업무함에서 이동: {exceptionReturn.title}</span><button type="button" className="outline" onClick={() => { setExceptionReturn(null); setSection('dashboard'); requestAnimationFrame(() => document.querySelector('.expense-exception-inbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>예외 업무함으로 돌아가기</button></div>}
    {section === 'dashboard' && <><FinanceReportDashboard organizationId={organizationId} onOpenLedger={date => { setLedgerDate(date); setSection('ledger'); }}/><ExpenseExceptionInbox organizationId={organizationId} onNavigate={item => { if (item.target === 'closeouts') { document.querySelector('.finance-report-dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } const nextSection = item.target === 'receipts' ? 'evidence' : 'cards'; setExceptionReturn(item); setSection(nextSection); requestAnimationFrame(() => document.querySelector('.expense-workspace-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}/>{canManageExpenses && <ManualExpenseForm organizationId={organizationId} employees={employees}/>}</>}
    {section === 'ledger' && <ExpenseLedger organizationId={organizationId} focusDate={ledgerDate}/>}
    {section === 'evidence' && <><ExpenseReviewQueue organizationId={organizationId}/><ExpenseReminderSettings organizationId={organizationId}/></>}
    {section === 'cards' && <CorporateCards organizationId={organizationId} employees={employees}/>}
    {section === 'labor' && <Payroll employees={employees} onSelect={onSelectEmployee} canManage={false} onOpenPayroll={onOpenPayroll}/>}
    {section === 'settlement' && <FinanceDocuments organizationId={organizationId}/>}
  </div>;
}

function FeedbackHub({ organizationId }) {
  const [items, setItems] = useState([]); const [notes, setNotes] = useState([]); const [loading, setLoading] = useState(true); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const refresh = () => { setLoading(true); Promise.all([loadFeedbackItems(organizationId), loadMeetingNotes(organizationId)]).then(([feedback, meetings]) => { setItems(feedback); setNotes(meetings); }).catch(error => setMessage(error.message || '목록을 불러오지 못했습니다.')).finally(() => setLoading(false)); };
  useEffect(() => { if (organizationId) refresh(); }, [organizationId]);
  const parseCsv = text => {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (character === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted; }
      else if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index += 1; row.push(cell.trim()); if (row.some(value => value)) rows.push(row); row = []; cell = ''; }
      else cell += character;
    }
    row.push(cell.trim()); if (row.some(value => value)) rows.push(row);
    return rows;
  };
  const normalizeHeader = value => String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const normalizeSource = (value, fallback) => {
    const source = String(value || '').trim().toLowerCase();
    if (source.includes('google') || source.includes('구글')) return 'google';
    if (source.includes('naver') || source.includes('네이버')) return 'naver';
    if (source.includes('kakao') || source.includes('카카오')) return 'kakao';
    if (source.includes('catch') || source.includes('캐치')) return 'catchtable';
    return fallback === 'internal' ? 'other' : fallback;
  };
  const csvFingerprint = value => { let hash = 5381; for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index); return `csv_${(hash >>> 0).toString(36)}`; };
  const importCsv = async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get('csvFile'); const defaultSource = form.get('csvSource');
    if (!(file instanceof File) || !file.size) { setMessage('가져올 CSV 파일을 선택해 주세요.'); return; }
    if (file.size > 5 * 1024 * 1024) { setMessage('CSV 파일은 5MB 이하만 가져올 수 있어요.'); return; }
    setBusy(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error('제목 행과 리뷰 데이터가 포함된 CSV를 선택해 주세요.');
      const headers = rows[0].map(normalizeHeader);
      const column = (...names) => headers.findIndex(header => names.some(name => header === normalizeHeader(name)));
      const authorIndex = column('작성자', '고객명', 'author', 'writer', 'name'); const ratingIndex = column('평점', '별점', 'rating', 'stars', 'star');
      const contentIndex = column('리뷰', '내용', '본문', 'content', 'comment', 'review', '후기'); const dateIndex = column('작성일', '작성날짜', '등록일', '작성시간', 'date', 'createdat', 'created');
      const sourceIndex = column('채널', 'source', 'platform', '매체'); const idIndex = column('리뷰id', 'reviewid', 'externalid', 'id', '번호');
      if (contentIndex < 0) throw new Error('리뷰 내용 열을 찾지 못했어요. “리뷰”, “내용”, “content” 중 하나를 사용해 주세요.');
      const imported = rows.slice(1).flatMap(values => {
        const content = String(values[contentIndex] || '').trim(); if (!content) return [];
        const source = normalizeSource(sourceIndex >= 0 ? values[sourceIndex] : '', defaultSource);
        const rawDate = dateIndex >= 0 ? values[dateIndex] : ''; const parsedDate = rawDate ? new Date(rawDate) : null;
        const rating = ratingIndex >= 0 ? Number(String(values[ratingIndex] || '').replace(',', '.')) : null;
        const author = authorIndex >= 0 ? String(values[authorIndex] || '').trim() : '';
        const externalId = idIndex >= 0 ? String(values[idIndex] || '').trim() : '';
        return [{ organization_id: organizationId, source, kind: 'review', author_name: author || null, content, rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : null, occurred_at: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(), status: 'open', external_id: externalId || csvFingerprint(`${source}|${author}|${content}|${rawDate}|${rating || ''}`) }];
      });
      if (!imported.length) throw new Error('가져올 리뷰 내용이 없습니다.');
      const result = await importFeedbackItems(imported); event.currentTarget.reset(); setMessage(`${result.count}건의 리뷰를 가져왔어요. 중복 리뷰는 최신 값으로 갱신됩니다.`); refresh();
    } catch (error) { setMessage(error.message || 'CSV 리뷰를 가져오지 못했습니다.'); } finally { setBusy(false); }
  };
  const submitFeedback = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await createFeedbackItem({ organization_id: organizationId, kind: form.get('kind'), author_name: form.get('author') || null, content: form.get('content'), occurred_at: new Date().toISOString() }); event.currentTarget.reset(); setMessage('컴플레인을 등록했어요.'); refresh(); } catch (error) { setMessage(error.message || '등록하지 못했습니다.'); } finally { setBusy(false); } };
  const submitNote = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await createMeetingNote({ organization_id: organizationId, title: form.get('title'), body: form.get('body'), meeting_at: new Date().toISOString() }); event.currentTarget.reset(); setMessage('회의 노트를 저장했어요.'); refresh(); } catch (error) { setMessage(error.message || '저장하지 못했습니다.'); } finally { setBusy(false); } };
  const resolve = async item => { try { await updateFeedbackItem(item.id, { status: item.status === 'resolved' ? 'open' : 'resolved' }); refresh(); } catch (error) { setMessage(error.message || '상태를 변경하지 못했습니다.'); } };
  return <><div className="page-title"><div><p>고객 후기와 현장 이슈를 한 곳에서</p><h1>리뷰 · 컴플레인</h1><span>공식 제휴 API 또는 사업장 리뷰 CSV를 통합 관리합니다.</span></div></div><section className="card full-card"><div className="card-title"><div><h2>리뷰 CSV 가져오기</h2><p>채널별로 내려받은 CSV의 작성자·평점·내용·작성일을 자동 매핑합니다.</p></div></div><form className="settings-form" onSubmit={importCsv}><div className="settings-input-grid"><label>리뷰 채널<select name="csvSource" defaultValue="google"><option value="google">Google</option><option value="naver">Naver</option><option value="kakao">Kakao</option><option value="catchtable">Catchtable</option><option value="other">기타 채널</option></select></label><label>CSV 파일<input name="csvFile" type="file" accept=".csv,text/csv" required/></label></div><p className="settings-help">지원 열: 리뷰/내용, 작성자, 평점, 작성일, 채널, 리뷰 ID. 채널·리뷰 ID가 없으면 선택한 채널과 내용 기반 ID를 사용합니다.</p><button className="submit" disabled={busy}>{busy ? '가져오는 중…' : 'CSV 리뷰 가져오기'}</button></form></section><section className="schedule-layout"><section className="card full-card"><div className="card-title"><div><h2>이슈 등록</h2><p>발생 시각과 내용을 남겨 후속 조치를 관리하세요.</p></div></div><form className="settings-form" onSubmit={submitFeedback}><div className="settings-input-grid"><label>구분<select name="kind" defaultValue="complaint"><option value="complaint">컴플레인</option><option value="suggestion">개선 제안</option></select></label><label>작성자 또는 고객명<input name="author" placeholder="선택 입력"/></label></div><label>내용<textarea name="content" required placeholder="언제, 어떤 이슈가 발생했는지 입력해 주세요."/></label><button className="submit" disabled={busy}>{busy ? '등록 중…' : '이슈 등록'}</button></form></section><section className="card full-card"><div className="card-title"><div><h2>처리 목록</h2><p>Google·Naver·Kakao·Catchtable 리뷰와 내부 이슈를 함께 표시합니다.</p></div><Chip type="orange">미처리 {items.filter(item => item.status !== 'resolved').length}건</Chip></div>{loading ? <LoadingBar label="이슈를 불러오는 중…"/> : items.length ? items.map(item => <div className="salary-row" key={item.id}><span className="grow"><b>{item.source === 'internal' ? (item.kind === 'complaint' ? '컴플레인' : '개선 제안') : `${item.source} 리뷰`}{item.rating ? ` · ${item.rating}점` : ''}</b><small>{item.author_name || '익명'} · {new Date(item.occurred_at).toLocaleString('ko-KR')}<br/>{item.content}</small></span><Chip type={item.status === 'resolved' ? 'green' : 'orange'}>{item.status === 'resolved' ? '처리 완료' : '확인 필요'}</Chip><button className="outline" onClick={() => resolve(item)}>{item.status === 'resolved' ? '다시 열기' : '처리 완료'}</button></div>) : <div className="empty-schedule"><b>등록된 이슈가 없어요.</b><span>CSV 리뷰를 가져오거나 내부 이슈를 등록해 주세요.</span></div>}</section></section><section className="card full-card"><div className="card-title"><div><h2>회의 노트</h2><p>관리자와 직원이 공유할 운영 회의록입니다.</p></div></div><form className="settings-form" onSubmit={submitNote}><div className="settings-input-grid"><label>회의 제목<input name="title" required placeholder="예: 주간 운영 회의"/></label></div><label>회의 내용<textarea name="body" placeholder="결정 사항과 담당 업무를 기록해 주세요."/></label><button className="outline" disabled={busy}>회의 노트 저장</button></form>{notes.length ? notes.slice(0, 5).map(note => <div className="salary-row" key={note.id}><span className="grow"><b>{note.title}</b><small>{new Date(note.meeting_at).toLocaleString('ko-KR')}<br/>{note.body || '내용 없음'}</small></span></div>) : null}</section>{message && <NoticeModal message={message} tone={/못|찾지|선택/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</>;
}

function EmployeeOrderPanel({ employees, onMove }) {
  const [dragging, setDragging] = useState(null); const [over, setOver] = useState(null);
  return <section className="card full-card employee-order-panel"><div className="card-title"><div><h2>직원 표시 순서</h2><p>직원을 잡아 원하는 위치에 놓으면 스케줄과 PDF 순서가 바로 저장됩니다.</p></div></div><div>{employees.map((employee,index)=><div key={employee.id} draggable className={`${dragging===index?'dragging ':''}${over===index&&dragging!==index?'drag-over':''}`} onDragStart={event=>{setDragging(index);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));}} onDragEnter={event=>{event.preventDefault();setOver(index);}} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move';}} onDrop={event=>{event.preventDefault();const from=dragging??Number(event.dataTransfer.getData('text/plain'));setDragging(null);setOver(null);if(Number.isInteger(from)&&from!==index)onMove(from,index);}} onDragEnd={()=>{setDragging(null);setOver(null);}}><span className="employee-drag-handle" aria-hidden="true">⠿</span><span className="employee-order-number">{index+1}</span><Avatar name={employee.name} color={employee.color}/><span className="grow"><b>{employee.name}</b><small>{employee.team} · {employee.role}</small></span></div>)}</div></section>;
}

function Employees({ employees, setModal, onSelect, canInvite, canViewPayroll = false }) { const [query, setQuery] = useState(''); const visibleEmployees = employees.filter(employee => `${employee.name} ${employee.team} ${employee.role}`.includes(query.trim())); const orderById = new Map(employees.map((employee,index)=>[employee.id,index+1])); return <><div className="page-title"><div><p>재직 {employees.length}명</p><h1>직원 관리</h1></div><div className="page-title-actions">{canInvite && <button className="outline" onClick={() => setModal('invite')}>직원 초대</button>}{canInvite && <button className="cta" onClick={() => setModal('employee')}>+ 직원 등록</button>}</div></div><section className="card full-card"><div className="search">⌕ <input value={query} onChange={event => setQuery(event.target.value)} placeholder="이름, 부서, 직책으로 검색" /></div>{visibleEmployees.length ? visibleEmployees.map(e => <div className="employee-row clickable-row" key={e.id} onClick={() => onSelect(e)}><b className="employee-list-number" aria-label={`${orderById.get(e.id)}번`}>{orderById.get(e.id)}</b><Avatar name={e.name} color={e.color}/><span className="grow"><b>{e.name}</b><small>{e.team} · {e.role}</small></span>{canViewPayroll && <span>{e.pay}</span>}<Chip type="green">재직</Chip><button className="outline" onClick={(event) => { event.stopPropagation(); onSelect(e); }}>상세</button></div>) : <div className="empty-schedule"><b>검색 결과가 없어요.</b><span>다른 이름이나 부서로 다시 검색해 주세요.</span></div>}</section></> }

function EmployeeDetail({ employee, schedules, leaveRequests, onBack, setModal, onNavigate, onRefresh, canViewPayroll = false, canManageSchedule = false }) {
  const currentDateKey = useCurrentKoreanDateKey();
  const profile = employee || defaultEmployees[0];
  const stateType = profile.state === '근무 중' ? 'green' : profile.state === '지각' ? 'orange' : 'gray';
  const pay = estimatedPayrollFor(profile);
  const payrollMinutes = profile.payrollMinutes ?? profile.monthMinutes;
  const completedDays = completedWorkDays(profile);
  const salaryByType = profile.pay === '연봉제'
    ? { label: '연봉', rate: Number(profile.annualSalary || 0), amount: `${formatMoney(profile.annualSalary)}/년`, metrics: [['월 환산', formatMoney(Number(profile.annualSalary || 0) / 12)], ['이번 달 예상', formatMoney(pay)]] }
    : profile.pay === '월급제'
      ? { label: '월급', rate: Number(profile.monthlySalary || 0), amount: `${formatMoney(profile.monthlySalary)}/월`, metrics: [['산정 기준', '월 고정급'], ['이번 달 예상', formatMoney(pay)]] }
      : profile.pay === '일급제'
        ? { label: '일급', rate: Number(profile.dailyWage || 0), amount: `${formatMoney(profile.dailyWage)}/일`, metrics: [['퇴근 완료', `${completedDays}일`], ['이번 달 예상', formatMoney(pay)]] }
        : { label: '시급', rate: Number(profile.hourlyWage || 0), amount: `${formatMoney(profile.hourlyWage)}/시간`, metrics: [['급여 반영 시간', formatHours(payrollMinutes)], ['이번 달 예상', formatMoney(pay)]] };
  const detailAttendance = (profile.attendanceHistory || []).slice(0, 4);
  const weekDays = weekDaysFor(currentDateKey);
  const weeklySchedules = weekDays.map(day => { const shift = (schedules[day.id] || []).find(([name]) => name === profile.name); return { ...day, time: shift?.[1] || '등록된 근무 없음', shiftName: shift?.[2] || '-' }; });
  const profileLeaves = leaveRequests.filter(request => request.staffId === profile.id).slice(0, 4);
  const approvedLeaveDays = profileLeaves.filter(request => request.status === '승인 완료').reduce((sum, request) => sum + Number(String(request.amount).replace('일', '')), 0);
  const pendingLeaveDays = profileLeaves.filter(request => request.status === '승인 대기').reduce((sum, request) => sum + Number(String(request.amount).replace('일', '')), 0);
  const grantedLeaveDays = profile.leaveEntitlement?.total ?? 15;
  const remainingLeave = Math.max(0, grantedLeaveDays - approvedLeaveDays);
  return <><div className="detail-back"><button onClick={onBack}>← 직원 목록</button></div><section className="employee-profile card"><div className="profile-main"><Avatar name={profile.name} color={profile.color}/><div><p>{profile.team} · {profile.role}</p><h1>{profile.name}</h1><span>{canViewPayroll ? `${profile.pay} · ` : ''}입사일 {profile.joinedOn || '미등록'}</span><span className="employee-phone">휴대전화 {formatPhone(profile.phone)}</span></div></div><div className="profile-actions">{canViewPayroll && <StaffProfileActions profile={profile} onRefresh={onRefresh}/>}{canManageSchedule && <button className="cta" onClick={() => setModal('schedule')}>+ 근무 추가</button>}</div></section>
    <section className="employee-summary"><div className="card"><p>오늘 상태</p><strong><Chip type={stateType}>{profile.state}</Chip></strong><span>출근 {profile.time}</span></div><div className="card"><p>이번 달 근무시간</p><strong>{formatHours(profile.monthMinutes)}</strong><span>실제 퇴근 기록 기준</span></div>{canViewPayroll && <div className="card salary-type-card"><div className="salary-type-heading"><p>급여 정보</p><Chip type="blue">{profile.pay}</Chip></div><strong>{salaryByType.rate > 0 ? salaryByType.amount : '단가 미등록'}</strong><div className="salary-type-metrics">{salaryByType.metrics.map(([label, value]) => <span key={label}><small>{label}</small><b>{salaryByType.rate > 0 ? value : '-'}</b></span>)}</div></div>}<div className="card"><p>연차 잔여</p><strong>{remainingLeave}<small>일</small></strong><span>발생 {grantedLeaveDays}일 · 사용 {approvedLeaveDays}일 · 대기 {pendingLeaveDays}일</span></div></section>
    <div className="employee-detail-grid"><section className="card"><div className="card-title"><div><h2>이번 주 근무 일정</h2><p>{weekDays[0].label} ~ {weekDays[6].label}</p></div><button onClick={() => onNavigate('schedule')}>전체 보기</button></div>{weeklySchedules.map(item => <div className="detail-row" key={item.id}><b>{item.id === currentDateKey ? '오늘' : item.label}</b><strong>{item.time}</strong><span>{item.shiftName}</span></div>)}</section><section className="card"><div className="card-title"><div><h2>최근 연차 · 요청</h2><p>실제 신청 및 처리 내역</p></div><button onClick={() => onNavigate('leave')}>전체 보기</button></div>{profileLeaves.length ? profileLeaves.map(request => <div className="detail-leave" key={request.id}><b>{request.date}</b><span>{request.type} {request.amount} 신청</span><Chip type={request.status === '승인 완료' ? 'green' : request.status === '반려' ? 'gray' : 'orange'}>{request.status}</Chip></div>) : <p className="empty-state">등록된 연차·휴가 신청이 없어요.</p>}<div className="leave-balance"><span>연차 발생 · 사용 현황</span><b>자동 {Number(profile.leaveEntitlement?.annualGranted || 0) + Number(profile.leaveEntitlement?.monthlyGranted || 0)}일 · 추가 {Number(profile.leaveEntitlement?.manualGranted || 0)}일</b><div className="progress"><i style={{ width: `${Math.min(100, approvedLeaveDays / Math.max(1, grantedLeaveDays) * 100)}%` }}/></div></div>{profile.leaveGrants?.length ? <div className="leave-grant-history"><b>추가 부여 이력</b>{profile.leaveGrants.slice(0,3).map(grant => <span key={grant.id}>+{grant.amount}일 · {grant.reason || '관리자 직접 부여'}</span>)}</div> : null}</section></div>
    <section className="card full-card"><div className="card-title"><div><h2>최근 출퇴근 기록</h2><p>실제 출근·퇴근 시각과 근무시간 기준</p></div><button onClick={() => onNavigate('attendance')}>전체 기록 보기</button></div>{detailAttendance.length ? detailAttendance.map(record => <div className="detail-attendance" key={record.id}><b>{record.work_date}</b><span className="attendance-times"><span>출근 <b>{formatAttendanceTime(record.checked_in_at)}</b></span><span>퇴근 <b>{formatAttendanceTime(record.checked_out_at)}</b></span></span><Chip type={record.checked_out_at ? 'gray' : 'green'}>{record.checked_out_at ? '퇴근 완료' : '근무 중'}</Chip><strong>{record.checked_out_at ? formatHours(attendanceMinutes(record)) : '진행 중'}</strong></div>) : <p className="empty-state">출퇴근 기록이 없어요.</p>}</section></>;
}

function StaffAvatarUploader({ profile, onSaved }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const changePhoto = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setMessage('');
    try { await uploadStaffAvatar({ organizationId: profile.organizationId, staffId: profile.id, file, previousPath: profile.avatarPath }); await onSaved?.(); setMessage('프로필 사진을 저장했어요.'); }
    catch (error) { setMessage(error.message || '프로필 사진을 저장하지 못했습니다.'); }
    finally { event.target.value = ''; setBusy(false); }
  };
  if (!profile?.organizationId) return null;
  return <div className="staff-avatar-uploader"><label className="outline" aria-busy={busy}>{busy ? '사진 저장 중…' : '프로필 사진 변경'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={changePhoto}/></label><small>JPG · PNG · WebP, 최대 5MB</small>{message && <NoticeModal message={message} tone={/못/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</div>;
}

function StaffProfileActionsLegacyV2({ profile, onRefresh }) {
  const [modal, setModal] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const saveProfile = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await updateStaffProfile({ staffId: profile.id, name: data.get('name'), phone: data.get('phone'), department: data.get('department'), jobTitle: data.get('jobTitle'), payType: data.get('payType'), hourlyWage: Number(data.get('hourlyWage')) || null, dailyWage: Number(data.get('dailyWage')) || null, monthlySalary: Number(data.get('monthlySalary')) || null, joinedOn: data.get('joinedOn') }); if (onRefresh) await onRefresh(); else window.location.reload(); setModal(''); setMessage('직원 개인정보를 저장했어요.'); } catch (error) { setMessage(error.message === 'invalid_phone' ? '전화번호 10~11자리를 입력해 주세요.' : error.message === 'daily_wage_required' ? '일급을 입력해 주세요.' : '직원 정보를 저장하지 못했습니다.'); } finally { setBusy(false); } };
  const grantLeave = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await grantStaffLeave({ staffId: profile.id, amount: Number(data.get('amount')), reason: data.get('reason') }); if (onRefresh) await onRefresh(); else window.location.reload(); setModal(''); setMessage(`연차 ${data.get('amount')}일을 추가 부여했어요.`); } catch (error) { setMessage(error.message === 'invalid_leave_amount' ? '0일 초과, 30일 이하로 입력해 주세요.' : '연차를 부여하지 못했습니다.'); } finally { setBusy(false); } };
  const payType = profile.pay === '월급제' ? 'monthly' : profile.pay === '일급제' ? 'daily' : 'hourly';
  return <><button className="outline" onClick={() => setModal('profile')}>정보 수정</button><button className="outline" onClick={() => setModal('grant')}>+ 연차 부여</button>{modal === 'profile' && <Modal title="직원 개인정보 수정" onClose={() => setModal('')}><form onSubmit={saveProfile}><p className="modal-text">수정한 전화번호는 태블릿 출퇴근·휴가 신청 인증에도 적용됩니다.</p><label>이름<input name="name" defaultValue={profile.name} required autoFocus/></label><label>휴대전화 번호<input name="phone" inputMode="tel" defaultValue={formatPhone(profile.phone)} required/></label><div className="form-row"><label>부서<input name="department" defaultValue={profile.team === '미정' ? '' : profile.team}/></label><label>직책<input name="jobTitle" defaultValue={profile.role} required/></label></div><div className="form-row"><label>급여 형태<select name="payType" defaultValue={payType}><option value="hourly">시급제</option><option value="monthly">월급제</option><option value="daily">일급제</option></select></label><label>시급<input name="hourlyWage" type="number" min="0" defaultValue={profile.hourlyWage || ''}/></label></div><div className="form-row"><label>일급<input name="dailyWage" type="number" min="0" defaultValue={profile.dailyWage || ''}/></label><label>월급<input name="monthlySalary" type="number" min="0" defaultValue={profile.monthlySalary || ''}/></label></div><label>재직 시작일<input name="joinedOn" type="date" defaultValue={profile.joinedOn || todayKey} required/></label><button className="submit" disabled={busy}>{busy ? '저장 중…' : '개인정보 저장'}</button></form></Modal>}{modal === 'grant' && <Modal title="연차 추가 부여" onClose={() => setModal('')}><form onSubmit={grantLeave}><p className="modal-text">자동 발생 연차와 별도로 추가 부여하며, 사유와 이력이 저장됩니다.</p><label>부여 일수<input name="amount" type="number" min="0.5" max="30" step="0.5" defaultValue="1" required autoFocus/></label><label>부여 사유<input name="reason" placeholder="예: 입사 보상, 특별 포상" required/></label><button className="submit" disabled={busy}>{busy ? '부여 중…' : '연차 부여하기'}</button></form></Modal>}{message && <NoticeModal message={message} tone={/못|입력/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</>;
}

// The editor deliberately never reads back full account or resident numbers.
// It only shows safe masks returned by the manager-authorized server endpoint.
function StaffSensitiveProfileFields({ staffId, busy, onSaved }) {
  const [profile, setProfile] = useState(null); const [loading, setLoading] = useState(true); const [message, setMessage] = useState('');
  useEffect(() => { loadStaffSensitiveProfile(staffId).then(setProfile).catch(error => setMessage(error.message || '지급 정보를 불러오지 못했습니다.')).finally(() => setLoading(false)); }, [staffId]);
  const save = async event => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); try { const saved = await saveStaffSensitiveProfile({ staffId, bankName: form.get('bankName'), bankAccount: form.get('bankAccount'), residentRegistrationNumber: form.get('residentRegistrationNumber') }); setProfile(saved); formElement.reset(); onSaved?.('계좌·주민등록 정보는 암호화해 저장했어요.'); } catch (error) { setMessage(error.message || '지급 정보를 저장하지 못했습니다.'); } };
  return <section className="settings-section"><div className="settings-section-head"><span className="settings-icon">⌁</span><div><h2>급여 지급 정보</h2><p>계좌번호와 주민등록번호는 서버에서 암호화해 보관하며, 원문은 다시 표시하지 않습니다.</p></div></div>{loading ? <LoadingBar label="지급 정보를 불러오는 중…"/> : <><p className="settings-help">등록 상태: {profile?.bank_name ? `${profile.bank_name} · ****${profile.bank_account_last4}` : '계좌 미등록'} / {profile?.resident_registration_mask || '주민등록번호 미등록'}</p><form className="settings-form" onSubmit={save}><div className="settings-input-grid"><label>은행명<input name="bankName" placeholder="예: 국민은행" disabled={busy}/></label><label>계좌번호<input name="bankAccount" inputMode="numeric" placeholder="숫자만 입력" disabled={busy}/></label></div><label>주민등록번호 <small>(선택 · 암호화 보관)</small><input name="residentRegistrationNumber" inputMode="numeric" placeholder="13자리 숫자" maxLength="14" disabled={busy}/></label><button className="outline" disabled={busy}>{busy ? '저장 중…' : '지급 정보 저장'}</button></form></>}{message && <NoticeModal message={message} tone="error" onClose={() => setMessage('')}/>}</section>;
}

function StaffProfileActionsLegacy({ profile, onRefresh }) {
  const [modal, setModal] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const payType = profile.pay === '월급제' ? 'monthly' : profile.pay === '일급제' ? 'daily' : profile.pay === '연봉제' ? 'annual' : 'hourly';
  const saveProfile = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await updateStaffProfile({ staffId: profile.id, name: data.get('name'), phone: data.get('phone'), department: data.get('department'), jobTitle: data.get('jobTitle'), payType: data.get('payType'), hourlyWage: Number(data.get('hourlyWage')) || null, dailyWage: Number(data.get('dailyWage')) || null, monthlySalary: Number(data.get('monthlySalary')) || null, annualSalary: Number(data.get('annualSalary')) || null, joinedOn: data.get('joinedOn') }); await onRefresh?.(); setMessage('직원 기본 정보를 저장했어요.'); } catch (error) { setMessage(error.message === 'annual_salary_required' ? '연봉을 입력해 주세요.' : error.message === 'invalid_phone' ? '전화번호 10~11자리를 입력해 주세요.' : '직원 정보를 저장하지 못했습니다.'); } finally { setBusy(false); } };
  const grantLeave = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await grantStaffLeave({ staffId: profile.id, amount: Number(data.get('amount')), reason: data.get('reason') }); await onRefresh?.(); setModal(''); setMessage(`연차 ${data.get('amount')}일을 추가 부여했어요.`); } catch { setMessage('연차를 부여하지 못했습니다.'); } finally { setBusy(false); } };
  return <><button className="outline" onClick={() => setModal('profile')}>정보 수정</button><button className="outline" onClick={() => setModal('grant')}>+ 연차 부여</button>{modal === 'profile' && <Modal title="직원 정보 · 급여 지급 정보 수정" onClose={() => setModal('')}><form className="settings-form" onSubmit={saveProfile}><p className="modal-text">전화번호 변경은 태블릿 인증에도 바로 반영됩니다.</p><div className="settings-input-grid"><label>이름<input name="name" defaultValue={profile.name} required/></label><label>휴대전화 번호<input name="phone" inputMode="tel" defaultValue={formatPhone(profile.phone)} required/></label><label>부서<input name="department" defaultValue={profile.team === '미정' ? '' : profile.team}/></label><label>직책<input name="jobTitle" defaultValue={profile.role} required/></label></div><div className="settings-input-grid"><label>급여 형태<select name="payType" defaultValue={payType}><option value="hourly">시급제</option><option value="daily">일급제</option><option value="monthly">월급제</option><option value="annual">연봉제</option></select></label><label>시급<input name="hourlyWage" type="number" min="0" defaultValue={profile.hourlyWage || ''}/></label><label>일급<input name="dailyWage" type="number" min="0" defaultValue={profile.dailyWage || ''}/></label><label>월급<input name="monthlySalary" type="number" min="0" defaultValue={profile.monthlySalary || ''}/></label><label>연봉<input name="annualSalary" type="number" min="0" defaultValue={profile.annualSalary || ''}/></label><label>재직 시작일<input name="joinedOn" type="date" defaultValue={profile.joinedOn || todayKey} required/></label></div><button className="submit" disabled={busy}>{busy ? '저장 중…' : '기본 정보 저장'}</button></form><StaffSensitiveProfileFields staffId={profile.id} busy={busy} onSaved={setMessage}/></Modal>}{modal === 'grant' && <Modal title="연차 추가 부여" onClose={() => setModal('')}><form onSubmit={grantLeave}><label>부여 일수<input name="amount" type="number" min="0.5" max="30" step="0.5" defaultValue="1" required/></label><label>부여 사유<input name="reason" required/></label><button className="submit" disabled={busy}>{busy ? '부여 중…' : '연차 부여하기'}</button></form></Modal>}{message && <NoticeModal message={message} tone={/못|입력/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</>;
}

function StaffProfileActions({ profile, onRefresh }) {
  const [modal, setModal] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const payType = profile.pay === '월급제' ? 'monthly' : profile.pay === '일급제' ? 'daily' : profile.pay === '연봉제' ? 'annual' : 'hourly';
  const [selectedPayType, setSelectedPayType] = useState(payType);
  useEffect(() => { setSelectedPayType(payType); }, [payType, profile.id]);
  const saveProfile = async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true);
    try { await updateStaffProfile({ staffId: profile.id, name: data.get('name'), phone: data.get('phone'), categoryId: data.get('categoryId') || null, department: profile.team, jobTitle: data.get('jobTitle'), payType: data.get('payType'), hourlyWage: parseMoney(data.get('hourlyWage')) || null, dailyWage: parseMoney(data.get('dailyWage')) || null, monthlySalary: parseMoney(data.get('monthlySalary')) || null, annualSalary: parseMoney(data.get('annualSalary')) || null, joinedOn: data.get('joinedOn') }); await onRefresh?.(); setMessage('직원 기본 정보를 저장했어요.'); }
    catch (error) { setMessage(error.message === 'invalid_staff_category' ? '운영 설정에 등록된 직원 구분을 선택해 주세요.' : error.message === 'annual_salary_required' ? '연봉을 입력해 주세요.' : error.message === 'invalid_phone' ? '전화번호 10~11자리를 입력해 주세요.' : '직원 정보를 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const grantLeave = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await grantStaffLeave({ staffId: profile.id, amount: Number(data.get('amount')), reason: data.get('reason') }); await onRefresh?.(); setModal(''); setMessage(`연차 ${data.get('amount')}일을 추가 부여했어요.`); } catch { setMessage('연차를 부여하지 못했습니다.'); } finally { setBusy(false); } };
  return <><button className="outline" onClick={() => { setSelectedPayType(payType); setModal('profile'); }}>정보 수정</button><button className="outline" onClick={() => setModal('grant')}>+ 연차 부여</button>{modal === 'profile' && <Modal title="직원 정보 · 급여 지급 정보 수정" onClose={() => setModal('')}><form className="settings-form" onSubmit={saveProfile}><p className="modal-text">직원 구분은 운영 설정에서 만든 항목으로만 지정합니다. 급여 형태를 선택하면 해당 단가만 입력할 수 있습니다.</p><div className="settings-input-grid"><label>이름<input name="name" defaultValue={profile.name} required/></label><label>휴대전화 번호<input name="phone" inputMode="tel" defaultValue={formatPhone(profile.phone)} required/></label><label>직원 구분<StaffCategorySelect organizationId={profile.organizationId} defaultValue={profile.categoryId || ''} disabled={busy}/></label><label>직책<input name="jobTitle" defaultValue={profile.role} required/></label></div><section className="pay-type-editor"><label>급여 형태<select name="payType" value={selectedPayType} onChange={event => setSelectedPayType(event.target.value)} disabled={busy}><option value="hourly">시급제</option><option value="daily">일급제</option><option value="monthly">월급제</option><option value="annual">연봉제</option></select></label>{selectedPayType === 'hourly' && <label>시급<MoneyInput name="hourlyWage" defaultValue={profile.hourlyWage || ''} placeholder="예: 12,000" required disabled={busy}/></label>}{selectedPayType === 'daily' && <label>일급<MoneyInput name="dailyWage" defaultValue={profile.dailyWage || ''} placeholder="예: 100,000" required disabled={busy}/></label>}{selectedPayType === 'monthly' && <label>월급<MoneyInput name="monthlySalary" defaultValue={profile.monthlySalary || ''} placeholder="예: 2,500,000" required disabled={busy}/></label>}{selectedPayType === 'annual' && <label>연봉<MoneyInput name="annualSalary" defaultValue={profile.annualSalary || ''} placeholder="예: 36,000,000" required disabled={busy}/></label>}</section><label>재직 시작일<input name="joinedOn" type="date" defaultValue={profile.joinedOn || todayKey} required/></label><button className="submit" disabled={busy}>{busy ? '저장 중…' : '기본 정보 저장'}</button></form><StaffSensitiveProfileFields staffId={profile.id} busy={busy} onSaved={setMessage}/></Modal>}{modal === 'grant' && <Modal title="연차 추가 부여" onClose={() => setModal('')}><form onSubmit={grantLeave}><label>부여 일수<input name="amount" type="number" min="0.5" max="30" step="0.5" defaultValue="1" required/></label><label>부여 사유<input name="reason" required/></label><button className="submit" disabled={busy}>{busy ? '부여 중…' : '연차 부여하기'}</button></form></Modal>}{message && <NoticeModal message={message} tone={/못|입력/.test(message) ? 'error' : 'success'} onClose={() => setMessage('')}/>}</>;
}

const employeeScheduleRows = (schedules, staffId) => Object.entries(schedules).flatMap(([date, rows]) => rows.filter(row => row[4] === staffId).map(row => ({ date, time: row[1], shiftName: row[2] || '일반 근무' }))).sort((a, b) => a.date.localeCompare(b.date));
const plannedMinutes = row => { const [start, end] = String(row.time || '').split(' – '); if (!start || !end || row.time === '휴무') return 0; const toMinutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; }; return Math.max(0, toMinutes(end) - toMinutes(start)); };

function EmployeeHome({ setActive, checkedIn, setCheckedIn, profile, employee, schedules, leaveRequests }) {
  const rows = employee ? employeeScheduleRows(schedules, employee.id) : [];
  const todayShift = rows.find(row => row.date === todayKey);
  const upcoming = rows.filter(row => row.date >= todayKey).slice(0, 3);
  const weekEnd = weekDaysFor(todayKey)[6].id;
  const weekMinutes = rows.filter(row => row.date >= weekDaysFor(todayKey)[0].id && row.date <= weekEnd).reduce((sum, row) => sum + plannedMinutes(row), 0);
  const approved = leaveRequests.filter(row => row.staffId === employee?.id && row.status === '승인 완료').reduce((sum, row) => sum + Number(String(row.amount).replace('일', '')), 0);
  const balance = Math.max(0, Number(employee?.leaveEntitlement?.total || 0) - approved);
  return <><div className="personal-hero"><div><p className="date-label">{today}</p><h1>안녕하세요, {profile?.display_name || '직원'}님 👋</h1><p>오늘도 좋은 하루 보내세요.</p></div><button className={checkedIn ? 'checkin complete' : 'checkin'} onClick={() => setCheckedIn(!checkedIn)}>{checkedIn ? '✓ 출근 완료' : '◷ 출근 기록'}</button></div>{profile?.employee_code && <section className="card invite-card employee-code-card"><p>내 직원 고유번호</p><h2>{profile.employee_code}</h2><span>관리자에게 이 번호를 전달하면 사업장 초대를 받을 수 있어요.</span></section>}
    <section className="today-shift card"><div><div className="card-title"><div><p>오늘의 근무</p><h2>{todayShift ? todayShift.shiftName : '등록된 근무 없음'}</h2></div><Chip type={todayShift && todayShift.time !== '휴무' ? 'green' : 'gray'}>{todayShift?.time === '휴무' ? '휴무' : todayShift ? '근무 예정' : '일정 없음'}</Chip></div>{todayShift && todayShift.time !== '휴무' ? <><div className="shift-time"><b>{todayShift.time.split(' – ')[0]}</b><i/><b>{todayShift.time.split(' – ')[1]}</b></div><div className="shift-meta"><span>예상 근무 {formatHours(plannedMinutes(todayShift))}</span><button onClick={() => setActive('mySchedule')}>스케줄 보기 →</button></div></> : <div className="shift-meta"><span>{todayShift?.time === '휴무' ? '오늘은 휴무예요.' : '관리자가 근무 일정을 등록하면 여기에 표시돼요.'}</span><button onClick={() => setActive('mySchedule')}>스케줄 보기 →</button></div>}</div></section>
    <div className="personal-grid"><section className="card mini-card"><p>이번 주 예정 근무시간</p><strong>{formatHours(weekMinutes)}</strong><span>등록된 근무 일정 기준</span><div className="progress"><i style={{ width: weekMinutes ? '100%' : '0%' }}/></div></section><section className="card mini-card"><p>남은 연차</p><strong>{balance}<small>일</small></strong><span>발생 {Number(employee?.leaveEntitlement?.total || 0)}일 · 사용 {approved}일</span><button className="link-button" onClick={() => setActive('myLeave')}>휴가 신청하기 →</button></section></div>
    <section className="card my-upcoming"><div className="card-title"><div><h2>다가오는 내 일정</h2><p>실제 등록된 스케줄</p></div><button onClick={() => setActive('mySchedule')}>전체 보기</button></div>{upcoming.length ? upcoming.map(row => <div className="upcoming-row" key={row.date}><b>{formatKoreanDate(row.date)}</b><span>{row.shiftName}</span><strong>{row.time}</strong></div>) : <p className="empty-state">등록된 근무 일정이 없어요.</p>}</section></>;
}

function MySchedule({ employee, schedules, profile }) { const rows = employee ? employeeScheduleRows(schedules, employee.id) : []; const monthKey = todayKey.slice(0, 7); const days = monthDaysFor(monthKey); const byDate = Object.fromEntries(rows.map(row => [row.date, row])); return <><div className="page-title"><div><p>{profile?.display_name || '내'}님의 일정</p><h1>내 스케줄</h1></div><button className="outline">{monthLabelFor(monthKey)}</button></div><section className="card my-calendar"><div className="calendar-days">{KOREAN_WEEKDAYS.map(day => <b key={day}>{day}</b>)}{days.map(day => { const shift = byDate[day.id]; return <div className={!day.inMonth ? 'muted' : shift?.time === '휴무' ? 'day-off' : shift ? 'has-shift' : ''} key={day.id}><b>{day.day}</b>{shift && <span>{shift.time === '휴무' ? '휴무' : shift.time.replaceAll(':00', '')}</span>}</div>; })}</div></section><section className="card full-card"><div className="card-title"><div><h2>등록된 근무 일정</h2><p>실제 등록된 일정만 표시됩니다.</p></div></div>{rows.length ? rows.map(row => <div className="my-schedule-row" key={row.date}><b>{formatKoreanDate(row.date)}</b><strong>{row.time}</strong><span>{row.shiftName}</span></div>) : <p className="empty-state">등록된 근무 일정이 없어요.</p>}</section></> }

function QrAttendance({ checkedIn, setCheckedIn }) {
  const videoRef = useRef(null); const streamRef = useRef(null); const [isOpen, setOpen] = useState(false); const [cameraError, setCameraError] = useState(''); const [status, setStatus] = useState('매장 QR 코드를 카메라에 비춰 주세요.');
  const stopCamera = () => { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; };
  useEffect(() => () => stopCamera(), []);
  const completeAttendance = async (token, source = 'QR') => {
    const action = checkedIn ? 'check_out' : 'check_in';
    try {
      if (supabase && !token) throw new Error('실제 출퇴근은 유효한 매장 QR 코드가 필요합니다.');
      if (supabase && token) await recordQrAttendance({ token, action });
      setCheckedIn(!checkedIn); setStatus(`${source} 인증 완료 · ${checkedIn ? '퇴근' : '출근'} 처리됐어요.`);
    } catch (error) {
      setCameraError(error.message || '출퇴근 기록을 저장하지 못했습니다. 네트워크와 QR 유효 시간을 확인해 주세요.');
    }
  };
  const startCamera = async () => { setCameraError(''); setOpen(true); try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); } if ('BarcodeDetector' in window) { const detector = new window.BarcodeDetector({ formats: ['qr_code'] }); const scan = async () => { if (!videoRef.current || !streamRef.current) return; try { const result = await detector.detect(videoRef.current); if (result.length) { stopCamera(); setOpen(false); await completeAttendance(result[0].rawValue); return; } } catch (_) {} window.setTimeout(scan, 450); }; scan(); } else setStatus('카메라 촬영 후 하단 버튼으로 인증을 완료해 주세요.'); } catch (_) { setCameraError('카메라를 사용할 수 없습니다. 브라우저 권한을 허용한 뒤 다시 시도해 주세요.'); } };
  const completeByPhoto = async () => { stopCamera(); setOpen(false); await completeAttendance(null, '사진'); };
  return <section className="card qr-card"><div className="qr-icon">⌘</div><div><p>QR 출퇴근</p><h2>{checkedIn ? '퇴근할 시간이에요' : '매장 QR로 출근하기'}</h2><span>{status}</span></div><button className="cta" onClick={startCamera}>{checkedIn ? 'QR 퇴근' : 'QR 출근'}</button>{isOpen && <div className="scanner"><video ref={videoRef} muted playsInline/><div className="scan-frame"/><p>{cameraError || 'QR 코드를 찾는 중…'}</p><div><button className="outline" onClick={() => {stopCamera();setOpen(false)}}>닫기</button><button className="cta" onClick={completeByPhoto}>사진 인증 완료</button></div></div>}</section>;
}

function MyAttendance({ checkedIn, setCheckedIn, employee }) { const history = employee?.attendanceHistory || []; const totalMinutes = history.filter(row => row.work_date >= weekDaysFor(todayKey)[0].id).reduce((sum, row) => sum + attendanceMinutes(row), 0); return <><div className="page-title"><div><p>{today}</p><h1>출퇴근</h1></div></div><QrAttendance checkedIn={checkedIn} setCheckedIn={setCheckedIn}/><section className="card full-card"><div className="card-title"><div><h2>이번 주 근무 기록</h2><p>내 실제 근무시간</p></div><strong className="total-hours">{formatHours(totalMinutes)}</strong></div>{history.length ? history.slice(0, 7).map(record => <div className="attendance-history" key={record.id}><b>{formatKoreanDate(record.work_date)}</b><span>출근 {record.checked_in_at ? new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'}).format(new Date(record.checked_in_at)) : '-'}</span><Chip type={record.checked_in_at && !record.checked_out_at ? 'green' : 'gray'}>{record.checked_in_at && !record.checked_out_at ? '근무 중' : record.checked_out_at ? '퇴근 완료' : '미출근'}</Chip><strong>{formatHours(attendanceMinutes(record))}</strong></div>) : <p className="empty-state">출퇴근 기록이 없어요.</p>}</section></> }

function MyLeave({ setModal, leaveRequests, profile, employee }) { const mine = leaveRequests.filter(item => item.staffId === employee?.id); const pending = mine.filter(item => item.status === '승인 대기'); const used = mine.filter(item => item.status === '승인 완료').reduce((sum, item) => sum + Number(String(item.amount).replace('일', '')), 0); const granted = Number(employee?.leaveEntitlement?.total || 0); const balance = Math.max(0, granted - used); return <><div className="page-title"><div><p>{profile?.display_name || '내'}님의 휴가</p><h1>연차 · 휴가</h1></div><button className="cta" onClick={() => setModal('leaveRequest')}>+ 휴가 신청</button></div><section className="personal-grid"><div className="card mini-card"><p>연차 잔여</p><strong>{balance}<small>일</small></strong><span>발생 {granted}일 · 사용 {used}일</span><div className="progress"><i style={{ width: granted ? `${Math.min(100, used / granted * 100)}%` : '0%' }}/></div></div><div className="card mini-card"><p>승인 대기</p><strong>{pending.length}<small>건</small></strong><span>{pending[0] ? `${pending[0].date} ${pending[0].type} 신청` : '대기 중인 신청이 없어요'}</span></div></section><section className="card full-card"><div className="card-title"><div><h2>내 휴가 내역</h2><p>최근 신청 및 사용 내역</p></div></div>{mine.length ? mine.map(request => <div className="leave-row" key={request.id}><span><b>{request.date}</b><small>{request.type} {request.amount}</small></span><span>개인 휴가</span><Chip type={request.status === '승인 완료' ? 'green' : request.status === '반려' ? 'gray' : 'orange'}>{request.status}</Chip></div>) : <p className="empty-state">등록된 휴가 내역이 없어요.</p>}</section></> }

function App() {
  useEffect(() => {
    document.querySelectorAll('input[name="hourlyWage"], input[name="dailyWage"], input[name="monthlySalary"], input[name="annualSalary"], input[name="rate"]').forEach(formatMoneyField);
  });
  useEffect(() => {
    const onMoneyInput = event => {
      if (event.target instanceof HTMLInputElement) formatMoneyField(event.target);
    };
    document.addEventListener('input', onMoneyInput, true);
    return () => document.removeEventListener('input', onMoneyInput, true);
  }, []);
  const [mode, setMode] = useState('manager'); const [active, setActive] = useState('dashboard'); const [managerGroup, setManagerGroup] = useState('operations'); const [employees, setEmployees] = useState(supabase ? [] : defaultEmployees); const [schedules, setSchedules] = useState(supabase ? {} : initialScheduleByDate); const [leaveRequests, setLeaveRequests] = useState(supabase ? [] : initialLeaveRequests); const [organizationSettings, setOrganizationSettings] = useState(DEFAULT_LEAVE_POLICY); const [selectedEmployee, setSelectedEmployee] = useState(defaultEmployees[0]); const [selectedLeave, setSelectedLeave] = useState(initialLeaveRequests[0]); const [modal, setModal] = useState(null); const [checkedIn, setCheckedIn] = usePersistedState('checked-in', false); const [toast, setToast] = useState(''); const [authContext, setAuthContext] = useState({ session: null, profile: null, membership: null, invitation: null }); const [authLoading, setAuthLoading] = useState(Boolean(supabase)); const [authStalled, setAuthStalled] = useState(false); const [workforceLoading, setWorkforceLoading] = useState(false); const [workforceError, setWorkforceError] = useState(''); const [authError, setAuthError] = useState(''); const [employeeSaving, setEmployeeSaving] = useState(false);
  const activeOrganizationRef = useRef(null);
  const activeAccountRef = useRef(null);
  const authResolvedRef = useRef(!supabase);
  const authGenerationRef = useRef(0);
  const clearWorkforceState = () => { setEmployees([]); setSchedules({}); setLeaveRequests([]); setSelectedEmployee(null); setSelectedLeave(null); setModal(null); };
  // Preserve the last successful response in this browser tab. Returning to a
  // page or refreshing its token must not briefly replace real data with zeros.
  const workforceCacheKey = context => {
    const userId = context?.session?.user?.id;
    const organizationId = context?.membership?.organization_id;
    return userId && organizationId ? `timefit:workforce:${userId}:${organizationId}` : null;
  };
  const restoreWorkforceSnapshot = context => {
    const key = workforceCacheKey(context);
    if (!key) return false;
    try {
      const snapshot = JSON.parse(window.sessionStorage.getItem(key) || 'null');
      if (!snapshot?.employees) return false;
      setOrganizationSettings(snapshot.organizationSettings || DEFAULT_LEAVE_POLICY);
      setEmployees(snapshot.employees);
      setSchedules(snapshot.schedules || {});
      setLeaveRequests(snapshot.leaveRequests || []);
      setSelectedEmployee(current => snapshot.employees.find(item => item.id === current?.id) || snapshot.employees[0] || null);
      return true;
    } catch { return false; }
  };
  useEffect(() => { if (!supabase) { setAuthLoading(false); return; } let activeEffect = true; const authStallTimer = window.setTimeout(() => { if (activeEffect && !authResolvedRef.current) { setAuthStalled(true); setAuthLoading(false); } }, 12000); const loadAuth = async (generation = ++authGenerationRef.current) => { try { let context = await getAuthContext(); let accountRole = context.managementAccount ? 'manager' : (context.profile?.role || context.session?.user.user_metadata?.role); if (accountRole === 'manager' && !context.membership && !context.managementAccount) { await ensureManagerOrganization(context.session); context = await getAuthContext(); accountRole = context.managementAccount ? 'manager' : (context.profile?.role || accountRole); } if (!activeEffect || generation !== authGenerationRef.current) return; const nextOrganizationId = context.membership?.organization_id || null; // Membership can arrive after the first session callback. It is still the same
      // account, so it must refresh data without sending the user back to Home.
      const nextAccountKey = context.session ? `${context.session.user.id}:${accountRole || ''}` : null; const isNewAccountContext = activeAccountRef.current !== nextAccountKey; const previousOrganizationId = activeOrganizationRef.current; const organizationChanged = previousOrganizationId !== nextOrganizationId; if (organizationChanged) { const isAccountOrBusinessSwitch = Boolean(activeAccountRef.current && (isNewAccountContext || (previousOrganizationId && previousOrganizationId !== nextOrganizationId))); activeOrganizationRef.current = nextOrganizationId; const restored = restoreWorkforceSnapshot(context); if (isAccountOrBusinessSwitch && !restored) clearWorkforceState(); setWorkforceLoading(Boolean(nextOrganizationId && !restored)); } activeAccountRef.current = nextAccountKey; setAuthStalled(false); setAuthError(''); setAuthContext(context); if (accountRole) { setMode(accountRole === 'manager' ? 'manager' : 'employee'); if (isNewAccountContext) setActive(accountRole === 'manager' ? 'dashboard' : 'employeeHome'); } } catch (error) { if (activeEffect && generation === authGenerationRef.current) { // A transient Edge Function failure during a background refresh must not
        // erase the dashboard or return the user to an empty default state.
        if (isAuthSessionError(error)) { clearWorkforceState(); activeOrganizationRef.current = null; activeAccountRef.current = null; setAuthContext({ session: null, profile: null, membership: null, invitation: null }); setAuthError('로그인 세션이 만료됐어요. 다시 로그인해 주세요.'); }
        else if (!activeAccountRef.current) { clearWorkforceState(); setAuthError(error.message || '계정 정보를 불러오지 못했습니다.'); setToast(error.message || '계정 정보를 불러오지 못했습니다.'); }
        setWorkforceLoading(false); } } finally { if (activeEffect && generation === authGenerationRef.current) { authResolvedRef.current = true; setAuthLoading(false); } } }; loadAuth(); const { data: listener } = supabase.auth.onAuthStateChange(event => { // Token refreshes are handled by Supabase internally. Resolving the
      // application context for each one made unnecessary Edge Function calls.
      // `INITIAL_SESSION` is already handled by the explicit loadAuth() above.
      // Re-running it (and USER_UPDATED) during navigation created overlapping
      // context/workforce requests and left the dashboard in a loading state.
      if (!['SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;
      if (event === 'SIGNED_OUT') { authGenerationRef.current += 1; clearWorkforceState(); activeOrganizationRef.current = null; activeAccountRef.current = null; authResolvedRef.current = true; setAuthStalled(false); setAuthLoading(false); setWorkforceLoading(false); setAuthContext({ session: null, profile: null, membership: null, invitation: null }); return; }
      // Always resolve a new sign-in, but discard responses from any older
      // auth cycle. This makes logout → immediate login deterministic.
      if (event === 'SIGNED_IN') { authResolvedRef.current = false; setAuthLoading(true); const generation = ++authGenerationRef.current; window.setTimeout(() => loadAuth(generation), 0); } }); return () => { activeEffect = false; window.clearTimeout(authStallTimer); listener.subscription.unsubscribe(); }; }, []);
  const refreshWorkforce = async (context = authContext, { background = false } = {}) => {
    const organizationId = context.membership?.organization_id;
    if (!supabase || !organizationId) return;
    // A settings save must not replace the current page with the global loader.
    // Keep the displayed snapshot interactive while fresh data is merged in.
    if (!background) setWorkforceLoading(true);
    try {
    // Mobile networks and a just-refreshed Supabase JWT can intermittently fail
    // the first batch request. Retry in place instead of leaving the page with
    // zero-value cards or navigating the manager back to the dashboard.
    let data; let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { data = await loadWorkforce(organizationId); break; }
      catch (error) { lastError = error; if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 700 * (attempt + 1))); }
    }
    if (!data) throw lastError || new Error('업무 데이터를 불러오지 못했습니다.');
    if (activeOrganizationRef.current !== organizationId) { if (!background) setWorkforceLoading(false); return; }
    const todayAttendance = Object.fromEntries(data.attendance.filter(item => item.work_date === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })).map(item => [item.staff_id, item]));
    const staff = data.staff.map((item, index) => { const attendance = todayAttendance[item.id]; const history = data.attendance.filter(record => record.staff_id === item.id); const monthlyRecords = history.filter(record => String(record.work_date || '').startsWith(todayKey.slice(0, 7))); const monthMinutes = monthlyRecords.reduce((sum, record) => sum + attendanceMinutes(record), 0); const payrollMinutes = monthlyRecords.reduce((sum, record) => sum + payableAttendanceMinutes(record, data.schedules || [], data.settings || DEFAULT_LEAVE_POLICY).payableMinutes, 0); const time = attendance?.checked_in_at ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(attendance.checked_in_at)) : '-'; return { id: item.id, userId: item.user_id, organizationId, sortOrder: Number(item.sort_order) || 0, name: item.account?.display_name || item.display_name || '직원', team: item.category?.name || item.department || '미분류', categoryId: item.category_id || null, categoryColor: item.category?.color || '#8B95A1', avatarPath: item.avatar_path || null, avatarUrl: item.avatar_url || null, role: item.job_title || '직원', pay: item.pay_type === 'monthly' ? '월급제' : item.pay_type === 'daily' ? '일급제' : item.pay_type === 'annual' ? '연봉제' : '시급제', hourlyWage: Number(item.hourly_wage) || 0, dailyWage: Number(item.daily_wage) || 0, monthlySalary: Number(item.monthly_salary) || 0, annualSalary: Number(item.annual_salary) || 0, joinedOn: item.joined_on, phone: item.phone_e164 || '', monthMinutes, payrollMinutes, attendanceHistory: history, state: attendance?.checked_in_at && !attendance?.checked_out_at ? '근무 중' : attendance?.checked_out_at ? '퇴근 완료' : '미출근', time, hours: attendance?.checked_out_at ? formatHours(attendanceMinutes(attendance)) : '-', color: ['purple','blue','orange','green'][index % 4] }; });
    data.staff.forEach((source, index) => {
      staff[index].scheduleHistory = (data.schedules || []).filter(schedule => schedule.staff_id === source.id);
      if (source.pay_type === 'annual') { staff[index].pay = '연봉제'; staff[index].annualSalary = Number(source.annual_salary) || 0; }
    });
    const enrichedStaff = staff.map(item => ({ ...item, leaveEntitlement: leaveEntitlementFor(item, data.schedules, data.settings || DEFAULT_LEAVE_POLICY, data.leaveGrants || []), leaveGrants: (data.leaveGrants || []).filter(grant => grant.staff_id === item.id) }));
    const byStaff = Object.fromEntries(enrichedStaff.map(item => [item.id, item]));
    const visibleSchedules = context.managementAccount || context.isOrganizationOwner ? data.schedules : data.schedules.filter(item => item.approval_status === 'approved');
    const remoteSchedules = visibleSchedules.reduce((result, item) => { const person = byStaff[item.staff_id]; if (!person) return result; const time = item.is_day_off ? '휴무' : `${item.starts_at?.slice(0,5)} – ${item.ends_at?.slice(0,5)}`; (result[item.work_date] ||= []).push([person.name, time, item.shift_name || '일반 근무', item.id, item.staff_id, person.team, person.categoryColor, Number(item.break_minutes) || 0, item.approval_status || 'approved', person.sortOrder, Boolean(item.break_paid)]); return result; }, {}); Object.values(remoteSchedules).forEach(rows => rows.sort((a,b)=>(a[9]??0)-(b[9]??0)));
    const remoteLeaves = data.leaves.map(item => ({ id: item.id, date: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(`${item.starts_on}T12:00:00`)), startsAt: item.starts_on, endsAt: item.ends_on, type: item.leave_type, employee: byStaff[item.staff_id]?.name || '직원', staffId: item.staff_id, amount: `${item.amount}일`, status: item.status === 'approved' ? '승인 완료' : item.status === 'rejected' ? '반려' : '승인 대기', reason: item.reason || '' }));
    const nextOrganizationSettings = { ...DEFAULT_LEAVE_POLICY, ...(data.settings || {}) };
    setWorkforceError(''); setOrganizationSettings(nextOrganizationSettings); setEmployees(enrichedStaff); setSchedules(remoteSchedules); setLeaveRequests(remoteLeaves); if (enrichedStaff.length) setSelectedEmployee(current => enrichedStaff.find(item => item.id === current?.id) || enrichedStaff[0]);
    try { const key = workforceCacheKey(context); if (key) window.sessionStorage.setItem(key, JSON.stringify({ employees: enrichedStaff, schedules: remoteSchedules, leaveRequests: remoteLeaves, organizationSettings: nextOrganizationSettings })); } catch { /* storage is an optional UX cache */ }
    } catch (error) {
      if (activeOrganizationRef.current === organizationId) { setWorkforceError('업무 데이터를 불러오지 못했어요.'); setToast(error.message || '업무 데이터를 불러오지 못했습니다.'); }
      throw error;
    } finally {
      if (activeOrganizationRef.current === organizationId && !background) setWorkforceLoading(false);
    }
  };
  const refreshWorkforceInPlace = () => refreshWorkforce(authContext, { background: true });
  const reorderEmployees = async (from, to) => {
    if (to < 0 || to >= employees.length) return;
    const previous = employees; const previousSchedules = schedules; const reordered = [...employees]; const [moved] = reordered.splice(from, 1); reordered.splice(to, 0, moved); const next = reordered.map((employee,index)=>({ ...employee, sortOrder:index })); const orderById = new Map(next.map(employee=>[employee.id,employee.sortOrder])); setEmployees(next); setSchedules(current=>Object.fromEntries(Object.entries(current).map(([date,rows])=>[date,rows.map(row=>{const copy=[...row];copy[9]=orderById.get(row[4])??copy[9];return copy;}).sort((a,b)=>(a[9]??0)-(b[9]??0))])));
    try { await saveStaffOrder(authContext.membership?.organization_id, next.map(employee => employee.id)); setToast('직원 순서를 저장했습니다.'); }
    catch (error) { setEmployees(previous); setSchedules(previousSchedules); setToast(error.message || '직원 순서를 저장하지 못했습니다.'); }
  };
  useEffect(() => { if (authContext.membership) refreshWorkforce().catch(error => setToast(error.message || '업무 데이터를 불러오지 못했습니다.')); }, [authContext.membership?.organization_id]);
  const navigateManager = id => { const group = managerMenuGroups.find(item => item.items.includes(id)); if (group) setManagerGroup(group.id); setActive(id); };
  const openEmployeeDetail = (employee) => { if (!employee) return; if (employee.__scheduleEdit) { setModal({ type: 'scheduleEdit', schedule: employee.__scheduleEdit }); return; } setSelectedEmployee(employee); setModal({ type: 'employeeDetail', staffId: employee.id }); };
  const openLeave = (request) => { setSelectedLeave(request); setModal('leave'); };
  const reviewSchedule = async (scheduleId, decision) => { try { await reviewWorkSchedule({ scheduleId, decision }); await refreshWorkforceInPlace(); setToast(decision === 'approved' ? '스케줄을 승인해 직원에게 공개했어요.' : '스케줄을 반려했어요.'); } catch (error) { setToast(error.message || '스케줄 승인을 처리하지 못했습니다.'); } };
  reviewSchedule.all = async scheduleIds => { try { await Promise.all(scheduleIds.map(scheduleId => reviewWorkSchedule({ scheduleId, decision: 'approved' }))); await refreshWorkforceInPlace(); setToast(`스케줄 ${scheduleIds.length}건을 모두 승인해 직원에게 공개했어요.`); } catch (error) { await refreshWorkforceInPlace(); setToast(error.message || '일부 스케줄의 전체 승인을 처리하지 못했습니다. 목록을 확인해 주세요.'); } };
  const canViewPayroll = Boolean(authContext.isOrganizationOwner || authContext.managementAccount?.permissions?.includes('payroll.view'));
  const canManageSchedule = Boolean(authContext.isOrganizationOwner || authContext.managementAccount?.permissions?.includes('schedule.manage'));
  const canManageExpenses = Boolean(authContext.isOrganizationOwner || authContext.managementAccount?.permissions?.includes('expense.manage'));
  const canManageSettings = Boolean(authContext.isOrganizationOwner || authContext.managementAccount?.permissions?.includes('settings.manage'));
  const managerContent = { dashboard: <Dashboard employees={employees} leaveRequests={leaveRequests} schedules={schedules} setModal={setModal} onOpenLeave={openLeave} checkedIn={checkedIn} onSelect={openEmployeeDetail} onNavigate={navigateManager} organizationId={authContext.membership?.organization_id} canViewPayroll={canViewPayroll} canManageEmployees={Boolean(authContext.isOrganizationOwner)}/>, attendance: <Attendance employees={employees} checkedIn={checkedIn} setCheckedIn={setCheckedIn} onSelect={openEmployeeDetail} canRecordOwnAttendance={employees.some(item => item.userId === authContext.session?.user?.id)} canCorrectAttendance={Boolean(authContext.isOrganizationOwner)} organizationId={authContext.membership?.organization_id} onRefresh={refreshWorkforceInPlace}/>, schedule: <><ScheduleCategorySummary employees={employees} scheduleByDate={schedules} onSelect={openEmployeeDetail} onEdit={schedule => setModal({ type: 'scheduleEdit', schedule })} canManage={canManageSchedule}/><Schedule setModal={setModal} employees={employees} onSelect={openEmployeeDetail} scheduleByDate={schedules} leaveRequests={leaveRequests} isOwner={authContext.isOrganizationOwner} onReview={reviewSchedule} onEdit={schedule => setModal({ type: 'scheduleEdit', schedule })} canManage={canManageSchedule}/></>, leave: <Leave setModal={openLeave} employees={employees} onSelect={openEmployeeDetail} leaveRequests={leaveRequests}/>, payroll: <Payroll employees={employees} onSelect={openEmployeeDetail} canManage={authContext.isOrganizationOwner}/>, sales: <SalesAnalytics organizationId={authContext.membership?.organization_id} canSyncSales={Boolean(authContext.isOrganizationOwner || authContext.managementAccount?.permissions?.includes('sales.sync'))}/>, documents: <><div className="page-title"><div><p>지출 원천과 정산 자료 통합 관리</p><h1>지출 · 증빙</h1><span>법인카드 승인내역과 세무 증빙을 한 곳에서 관리하세요.</span></div></div><ExpenseLedger organizationId={authContext.membership?.organization_id}/><ExpenseReminderSettings organizationId={authContext.membership?.organization_id}/><CorporateCards organizationId={authContext.membership?.organization_id} employees={employees}/><FinanceDocuments organizationId={authContext.membership?.organization_id}/></>, feedback: <FeedbackHub organizationId={authContext.membership?.organization_id}/>, employees: <><EmployeeOrderPanel employees={employees} onMove={reorderEmployees}/><Employees employees={employees} setModal={setModal} onSelect={openEmployeeDetail} canInvite={Boolean(authContext.isOrganizationOwner)} canViewPayroll={canViewPayroll}/></> , settings: <><Settings organizationId={authContext.membership?.organization_id} organizationName={authContext.membership?.timefit_user_organizations?.name}/><FinanceFeeSettings organizationId={authContext.membership?.organization_id}/><ManagementAccountSettings organizationId={authContext.membership?.organization_id} employees={employees} isOwner={authContext.isOrganizationOwner}/><StaffCategorySettings organizationId={authContext.membership?.organization_id}/><TossPlaceConnectionSettings organizationId={authContext.membership?.organization_id}/><TabletDeviceSettings organizationId={authContext.membership?.organization_id}/><LeavePolicySettings organizationId={authContext.membership?.organization_id}/><HolidayWorkCompensationSettings organizationId={authContext.membership?.organization_id}/><AttendancePayrollSettings organizationId={authContext.membership?.organization_id}/></>, employeeDetail: <EmployeeDetail employee={selectedEmployee} schedules={schedules} leaveRequests={leaveRequests} onBack={() => navigateManager('employees')} setModal={setModal} onNavigate={navigateManager} onRefresh={refreshWorkforceInPlace} canViewPayroll={canViewPayroll} canManageSchedule={canManageSchedule}/> };
  managerContent.documents = <ExpenseEvidenceWorkspace organizationId={authContext.membership?.organization_id} employees={employees} canManageExpenses={canManageExpenses} canViewPayroll={canViewPayroll} onSelectEmployee={openEmployeeDetail} onOpenPayroll={() => navigateManager('payroll')}/>;
  if (!authContext.isOrganizationOwner && canManageSettings) managerContent.settings = <Settings organizationId={authContext.membership?.organization_id} organizationName={authContext.membership?.timefit_user_organizations?.name}/>;
  const currentEmployee = employees.find(item => item.userId === authContext.session?.user?.id) || null;
  const managerIdentity = authContext.managementAccount?.login_id || authContext.session?.user?.email || authContext.profile?.display_name || '관리자';
  const employeeContent = { employeeHome: <EmployeeHome setActive={setActive} checkedIn={checkedIn} setCheckedIn={setCheckedIn} profile={authContext.profile} employee={currentEmployee} schedules={schedules} leaveRequests={leaveRequests}/>, mySchedule: <MySchedule employee={currentEmployee} schedules={schedules} profile={authContext.profile}/>, myAttendance: <MyAttendance checkedIn={checkedIn} setCheckedIn={setCheckedIn} employee={currentEmployee}/>, myLeave: <MyLeave setModal={setModal} leaveRequests={leaveRequests} profile={authContext.profile} employee={currentEmployee}/>, myReceipts: <EmployeeReceiptSubmission organizationId={authContext.membership?.organization_id} employee={currentEmployee}/> };
  const selectedManagerGroup = managerMenuGroups.find(group => group.id === managerGroup) || managerMenuGroups[0];
  const permissionNavMap = { dashboard:['dashboard.view'], attendance:['attendance.view'], schedule:['schedule.view'], leave:['leave.view'], payroll:['payroll.view'], sales:['sales.view','sales.sync'], documents:['finance.view','expense.manage'], employees:['employee.view'], settings:['settings.manage'] }; const allowedPermissions = authContext.managementAccount?.permissions || []; const permittedNav = authContext.managementAccount ? nav.filter(([id]) => permissionNavMap[id]?.some(permission => allowedPermissions.includes(permission))) : nav;
  const permittedGroups = managerMenuGroups.map(group => ({ ...group, items: group.items.filter(id => permittedNav.some(item => item[0] === id)) })).filter(group => group.items.length);
  const currentNav = mode === 'manager' ? permittedNav.filter(item => selectedManagerGroup.items.includes(item[0])) : employeeNav; const mobileNav = mode === 'manager' ? [...permittedNav.slice(0, 3), ['more', '더보기', '⋯']] : employeeNav; const screenContent = (mode === 'manager' ? managerContent : employeeContent)[active]; const content = screenContent;
  useEffect(() => { if (mode !== 'manager') return; const group = managerMenuGroups.find(item => item.items.includes(active)); if (group && group.id !== managerGroup) setManagerGroup(group.id); }, [active, mode, managerGroup]);
  const saveEmployee = async event => {
    event.preventDefault();
    if (employeeSaving) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') || '').trim();
    const bankName = String(data.get('bankName') || '').trim();
    const bankAccount = String(data.get('bankAccount') || '').replace(/\D/g, '');
    const residentRegistrationNumber = String(data.get('residentRegistrationNumber') || '').replace(/\D/g, '');
    if ((bankName && !bankAccount) || (!bankName && bankAccount)) { setToast('은행명과 계좌번호를 함께 입력해 주세요.'); return; }
    if (bankAccount && (bankAccount.length < 6 || bankAccount.length > 30)) { setToast('계좌번호는 숫자 6~30자리로 입력해 주세요.'); return; }
    if (residentRegistrationNumber && residentRegistrationNumber.length !== 13) { setToast('주민등록번호는 숫자 13자리로 입력해 주세요.'); return; }
    setEmployeeSaving(true);
    let staffId = null;
    try {
      staffId = await createManualStaff({ organizationId: authContext.membership.organization_id, name, phone: data.get('phone'), categoryId: data.get('categoryId') || null, jobTitle: data.get('role'), payType: data.get('payType'), hourlyWage: parseMoney(data.get('hourlyWage')) || null, dailyWage: parseMoney(data.get('dailyWage')) || null, monthlySalary: parseMoney(data.get('monthlySalary')) || null, annualSalary: parseMoney(data.get('annualSalary')) || null, joinedOn: data.get('joinedOn') });
      if (bankName || bankAccount || residentRegistrationNumber) await saveStaffSensitiveProfile({ staffId, bankName, bankAccount, residentRegistrationNumber });
      await refreshWorkforce(); setModal(null); setToast(`${name}님을 직접 등록했어요.`);
    } catch (error) {
      if (staffId) { await refreshWorkforce().catch(() => {}); setModal(null); setToast(`${name}님은 등록됐지만 지급 정보를 저장하지 못했어요. 직원 상세에서 다시 저장해 주세요.`); return; }
      const message = error.message || '직원 정보를 저장하지 못했습니다.';
      setToast(message === 'invalid_phone' ? '전화번호 10~11자리를 입력해 주세요.' : message === 'hourly_wage_required' ? '시급을 입력해 주세요.' : message === 'daily_wage_required' ? '일급을 입력해 주세요.' : message === 'monthly_salary_required' ? '월급을 입력해 주세요.' : message === 'annual_salary_required' ? '연봉을 입력해 주세요.' : `직원 등록 오류: ${message}`);
    } finally { setEmployeeSaving(false); }
  };
  const saveStaffPhone = async e => { e.preventDefault(); try { const phone = new FormData(e.currentTarget).get('phone'); await updateStaffPhone(selectedEmployee.id, phone); await refreshWorkforce(); setModal(null); setToast(`${selectedEmployee.name}님의 전화번호를 등록했어요.`); } catch (error) { setToast(error.message === 'invalid_phone' ? '전화번호 10~11자리를 입력해 주세요.' : '전화번호를 저장하지 못했습니다.'); } };
  const saveStaffProfile = async e => { e.preventDefault(); const data = new FormData(e.currentTarget); try { await updateStaffProfile({ staffId: selectedEmployee.id, name: data.get('name'), phone: data.get('phone'), department: data.get('department'), jobTitle: data.get('jobTitle'), payType: data.get('payType'), hourlyWage: Number(data.get('hourlyWage')) || null, dailyWage: Number(data.get('dailyWage')) || null, monthlySalary: Number(data.get('monthlySalary')) || null, joinedOn: data.get('joinedOn') }); await refreshWorkforce(); setModal(null); setToast(`${data.get('name')}님의 개인정보를 수정했어요.`); } catch (error) { const message = error.message || ''; setToast(message === 'invalid_phone' ? '전화번호 10~11자리를 입력해 주세요.' : message === 'hourly_wage_required' ? '시급을 입력해 주세요.' : message === 'daily_wage_required' ? '일급을 입력해 주세요.' : message === 'monthly_salary_required' ? '월급을 입력해 주세요.' : '직원 정보를 저장하지 못했습니다.'); } };
  const saveLeaveGrant = async e => { e.preventDefault(); const data = new FormData(e.currentTarget); try { await grantStaffLeave({ staffId: selectedEmployee.id, amount: Number(data.get('amount')), reason: data.get('reason') }); await refreshWorkforce(); setModal(null); setToast(`${selectedEmployee.name}님에게 연차 ${data.get('amount')}일을 추가 부여했어요.`); } catch (error) { setToast(error.message === 'invalid_leave_amount' ? '0일 초과, 30일 이하로 입력해 주세요.' : '연차를 부여하지 못했습니다.'); } };
  const reviewLeave = async (status) => { try { if (supabase) await reviewLeaveRequest({ id: selectedLeave.id, status: status === '승인 완료' ? 'approved' : 'rejected' }); else setLeaveRequests(items => items.map(item => item.id === selectedLeave.id ? { ...item, status } : item)); await refreshWorkforce(); setModal(null); setToast(`요청을 ${status === '승인 완료' ? '승인' : '반려'}했어요.`); } catch (error) { setToast(error.message || '휴가 요청을 처리하지 못했습니다.'); } };
  const saveLeaveRequest = async e => { e.preventDefault(); const data = new FormData(e.currentTarget); const startsAt = data.get('startsAt'); const type = data.get('type'); try { if (supabase) { const staff = employees.find(item => item.userId === authContext.session?.user?.id); if (!staff) throw new Error('사업장 직원 정보가 없습니다.'); await createLeaveRequest({ organizationId: authContext.membership.organization_id, staffId: staff.id, startsOn: startsAt, endsOn: data.get('endsAt'), leaveType: type, amount: type.includes('반차') ? 0.5 : 1, reason: data.get('reason') }); await refreshWorkforce(); } else setLeaveRequests(items => [{ id: `leave-${Date.now()}`, date: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(`${startsAt}T12:00:00`)), startsAt, type, employee: '이준호', amount: type.includes('반차') ? '0.5일' : '1일', status: '승인 대기', reason: data.get('reason') || '' }, ...items]); setModal(null); setToast('휴가 신청을 보냈어요. 관리자 승인 후 반영됩니다.'); } catch (error) { setToast(error.message || '휴가 신청을 저장하지 못했습니다.'); } };
  const saveSchedule = async e => { e.preventDefault(); const data = new FormData(e.currentTarget); const name = data.get('employee'); try { if (supabase) { const staff = employees.find(item => item.name === name); if (!staff) throw new Error('직원 정보를 찾을 수 없습니다.'); await saveWorkSchedule({ organizationId: authContext.membership.organization_id, staffId: staff.id, workDate: data.get('date'), startsAt: data.get('startsAt'), endsAt: data.get('endsAt'), shiftName: data.get('shiftName') }); await refreshWorkforce(); } else { const date = data.get('date'); const time = `${data.get('startsAt')} – ${data.get('endsAt')}`; const label = data.get('shiftName') || '일반 근무'; setSchedules(current => ({ ...current, [date]: [...(current[date] || []).filter(item => item[0] !== name), [name, time, label]] })); } setModal(null); setToast(`${name}님의 근무 일정을 저장했어요.`); } catch (error) { setToast(error.message || '근무 일정을 저장하지 못했습니다.'); } };
  const saveScheduleSelection = async ({ staffIds, dates, startsAt, endsAt, shiftName, breakMinutes, breakPaid = false, breakStartsAt, breakEndsAt, bulk }) => { try { if (supabase) { const result = await saveWorkSchedulesBulk({ organizationId: authContext.membership.organization_id, staffIds, workDates: dates, startsAt, endsAt, shiftName, breakMinutes, breakPaid, breakStartsAt, breakEndsAt }); await refreshWorkforce(); setModal(null); setToast(authContext.isOrganizationOwner ? `${result.count}건의 근무 일정을 ${bulk ? '일괄 등록' : '등록'}했어요.` : `${result.count}건의 근무 일정을 최고관리자 승인 요청으로 보냈어요.`); } else { const chosen = employees.filter(employee => staffIds.includes(employee.id)); setSchedules(current => { const next = { ...current }; dates.forEach(date => { next[date] = [...(next[date] || []).filter(([name]) => !chosen.some(employee => employee.name === name)), ...chosen.map(employee => [employee.name, `${startsAt} – ${endsAt}`, shiftName || '일반 근무'])]; }); return next; }); setModal(null); setToast(`${staffIds.length * dates.length}건의 근무 일정을 등록했어요.`); } } catch (error) { setToast(error.message || '근무 일정을 저장하지 못했습니다.'); } };
  const saveMonthlyScheduleChanges = async changes => { if (!Array.isArray(changes) && changes?.cancellations) { if (supabase) { for (const schedule of changes.cancellations) await deleteWorkSchedule(schedule.id); await refreshWorkforceInPlace(); } else { setSchedules(current => { const next = { ...current }; changes.cancellations.forEach(schedule => { next[schedule.date] = (next[schedule.date] || []).filter(row => row[3] !== schedule.id && row[0] !== schedule.name); }); return next; }); } setToast(`선택한 근무 일정 ${changes.cancellations.length}건을 취소했어요.`); return; } let count = 0; if (supabase) { for (const change of changes) { const result = await saveWorkSchedulesBulk({ organizationId: authContext.membership.organization_id, staffIds: change.staffIds, workDates: change.dates, startsAt: change.startsAt, endsAt: change.endsAt, shiftName: change.shiftName, breakMinutes: change.breakMinutes, breakPaid: change.breakPaid }); count += result.count; } await refreshWorkforceInPlace(); } else count = changes.reduce((sum, change) => sum + change.staffIds.length * change.dates.length, 0); setToast(authContext.isOrganizationOwner ? `월간 스케줄 ${count}건을 저장했어요.` : `월간 스케줄 ${count}건의 승인을 요청했어요.`); };
  const updateSchedule = async schedule => { try { if (supabase) { await saveWorkSchedule({ organizationId: authContext.membership.organization_id, staffId: schedule.staffId, workDate: schedule.date, startsAt: schedule.startsAt, endsAt: schedule.endsAt, shiftName: schedule.shiftName, breakMinutes: schedule.breakMinutes, breakPaid: schedule.breakPaid, breakStartsAt: schedule.breakStartsAt, breakEndsAt: schedule.breakEndsAt }); await refreshWorkforce(); } else { setSchedules(current => ({ ...current, [schedule.date]: (current[schedule.date] || []).map(item => item[0] === schedule.name ? [schedule.name, `${schedule.startsAt} – ${schedule.endsAt}`, schedule.shiftName, item[3], item[4], item[5], item[6], schedule.breakMinutes, item[8], item[9], Boolean(schedule.breakPaid)] : item) })); } setModal(null); setToast(authContext.isOrganizationOwner ? `${schedule.name}님의 일정을 수정했어요.` : `${schedule.name}님의 일정 수정 승인을 요청했어요.`); } catch (error) { setToast(error.message || '근무 일정을 수정하지 못했습니다.'); } };
  const removeSchedule = async schedule => { try { if (supabase) { if (!schedule.id) throw new Error('일정 식별 정보를 찾을 수 없습니다.'); await deleteWorkSchedule(schedule.id); await refreshWorkforce(); } else { setSchedules(current => ({ ...current, [schedule.date]: (current[schedule.date] || []).filter(item => item[0] !== schedule.name) })); } setModal(null); setToast(`${schedule.name}님의 근무 일정을 취소했어요.`); } catch (error) { setToast(error.message || '근무 일정을 취소하지 못했습니다.'); } };
  const sendInvite = async e => { e.preventDefault(); const data = new FormData(e.currentTarget); try { await inviteEmployeeByCode({ organizationId: authContext.membership.organization_id, employeeCode: data.get('employeeCode'), department: data.get('department'), jobTitle: data.get('jobTitle') }); setModal(null); setToast('직원 초대를 보냈어요. 직원이 수락하면 사업장에 연결됩니다.'); } catch (error) { setToast(error.message || '초대번호를 확인해 주세요.'); } };
  const acceptInvite = async () => { try { await acceptEmployeeInvitation(authContext.invitation.id); setAuthContext(await getAuthContext()); setToast('초대를 수락했어요. 이제 사업장에 연결됐습니다.'); } catch (error) { setToast(error.message || '초대를 수락하지 못했습니다.'); } };
  const logout = async () => { authGenerationRef.current += 1; clearWorkforceState(); activeOrganizationRef.current = null; activeAccountRef.current = null; setAuthError(''); setAuthContext({ session: null, profile: null, membership: null, invitation: null }); try { await signOut(); } catch (error) { if (!isAuthSessionError(error)) setToast('로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.'); } };
  // Only block the first session lookup. Workforce refreshes can happen while
  // moving between admin pages; keeping the shell mounted prevents a delayed
  // Supabase response from making navigation look frozen.
  if (authLoading || authStalled) return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><span>✓</span><b>timefit</b></div>{authStalled ? <><p className="auth-description">계정 정보를 확인하는 데 시간이 걸리고 있어요.</p><button className="cta" onClick={() => window.location.reload()}>다시 시도</button></> : <p className="auth-description">계정 정보를 불러오는 중입니다.</p>}</section></main>;
  if (!authContext.session) return <AuthScreen notice={authError}/>;
  const hasWorkforceSnapshot = employees.length > 0 || Object.keys(schedules).length > 0 || leaveRequests.length > 0;
  employeeAvatarRegistry = Object.fromEntries(employees.map(employee => [employee.name, employee]));
  return <div className={`app ${mode}`}><aside className="sidebar"><div className="brand"><span>✓</span><b>timefit</b></div><nav>{currentNav.map(([id,label,icon]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}><i>{icon}</i><span>{label}</span></button>)}</nav><div className="store"><small>현재 {mode === 'manager' ? '사업장' : '계정'}</small><b>{authContext.membership?.timefit_user_organizations?.name || (mode === 'manager' ? '타임핏 성수점' : '직원 초대 대기')}</b><span>{mode === 'manager' ? managerIdentity : authContext.profile?.display_name || ''}</span></div></aside><main><header><div className="header-leading"><div className="header-brand"><span>✓</span><b>timefit</b></div>{mode === 'manager' && <ManagerGroupTabs groups={permittedGroups} groupId={managerGroup} onChange={group => { setManagerGroup(group.id); navigateManager(group.items[0]); }}/>}</div><button className="profile has-id" title={`${mode === 'manager' ? managerIdentity : authContext.profile?.display_name || '계정'} · 로그아웃`} onClick={logout}><span className="profile-id">{mode === 'manager' ? managerIdentity : authContext.profile?.display_name || '계정'}</span><b>{(mode === 'manager' ? managerIdentity : authContext.profile?.display_name || '계정')[0].toUpperCase()}</b></button></header><div className="content">{workforceLoading && hasWorkforceSnapshot && <div className="workforce-status" role="status"><i/>최신 업무 데이터를 확인하고 있어요.</div>}{workforceError && <button className="workforce-retry" onClick={() => refreshWorkforce().catch(() => {})}>{workforceError} <b>다시 시도</b></button>}{authContext.invitation && mode === 'employee' && <section className="card invite-card"><p>사업장 초대가 도착했어요</p><h2>{authContext.invitation.timefit_user_organizations?.name || '사업장'}에 연결할까요?</h2><span>수락하면 내 스케줄과 출퇴근 기록을 확인할 수 있어요.</span><button className="cta" onClick={acceptInvite}>초대 수락하기</button></section>}{workforceLoading && !hasWorkforceSnapshot ? <section className="card workforce-initial-loading"><LoadingBar label="사업장 업무 데이터를 불러오는 중…"/></section> : content}</div></main><nav className="mobile-nav">{mobileNav.map(([id,label,icon]) => <button key={id} className={active === id || (id === 'more' && modal === 'more') ? 'active' : ''} onClick={() => id === 'more' ? setModal('more') : setActive(id)}><i>{icon}</i><span>{label.replace(' · 연차','')}</span></button>)}</nav>{toast&&<NoticeModal message={toast} tone={/못|오류|확인|필요|없습니다|입력|저장하지/.test(toast)?'error':'success'} onClose={()=>setToast('')}/>}
    {modal === 'employee' && authContext.isOrganizationOwner && <Modal title="직원 직접 등록" onClose={() => { if (!employeeSaving) setModal(null); }}><form onSubmit={saveEmployee} aria-busy={employeeSaving}><p className="modal-text">사업장 구분을 먼저 선택하면 직원 관리와 스케줄 인원 현황에 같은 색으로 표시됩니다.</p><label>이름<input name="name" placeholder="직원 이름" autoFocus required disabled={employeeSaving}/></label><label>휴대전화 번호<input name="phone" inputMode="tel" placeholder="예: 01012345678" required disabled={employeeSaving}/></label><div className="form-row"><label>근무 구분<StaffCategorySelect organizationId={authContext.membership?.organization_id} disabled={employeeSaving}/></label><label>직책<input name="role" placeholder="예: 바리스타" required disabled={employeeSaving}/></label></div><div className="form-row"><label>급여 형태<select name="payType" defaultValue="hourly" disabled={employeeSaving}><option value="hourly">시급제</option><option value="monthly">월급제</option><option value="daily">일급제</option><option value="annual">연봉제</option></select></label><label>시급 (시급제)<MoneyInput name="hourlyWage" placeholder="예: 12,000" disabled={employeeSaving}/></label></div><div className="form-row"><label>일급 (일급제)<MoneyInput name="dailyWage" placeholder="예: 100,000" disabled={employeeSaving}/></label><label>월급 (월급제)<MoneyInput name="monthlySalary" placeholder="예: 2,500,000" disabled={employeeSaving}/></label></div><label>연봉 (연봉제)<MoneyInput name="annualSalary" placeholder="예: 36,000,000" disabled={employeeSaving}/></label><section className="sensitive-registration"><b>급여 지급 정보 <small>선택 · 암호화 보관</small></b><p>계좌번호와 주민등록번호는 서버에서 암호화해 보관하며, 저장 후 원문은 다시 표시하지 않습니다.</p><div className="form-row"><label>은행명<input name="bankName" placeholder="예: 국민은행" disabled={employeeSaving}/></label><label>계좌번호<input name="bankAccount" inputMode="numeric" placeholder="숫자만 입력" disabled={employeeSaving}/></label></div><label>주민등록번호 <small>(선택 · 13자리)</small><input name="residentRegistrationNumber" inputMode="numeric" placeholder="13자리 숫자" maxLength="14" disabled={employeeSaving}/></label></section><label>재직 시작일<input name="joinedOn" type="date" defaultValue={todayKey} required disabled={employeeSaving}/></label><button className="submit" disabled={employeeSaving}>{employeeSaving ? '직원 등록 중…' : '직원 등록 완료'}</button></form></Modal>}
    {modal === 'staffPhone' && <Modal title="직원 전화번호 등록" onClose={() => setModal(null)}><form onSubmit={saveStaffPhone}><p className="modal-text">{selectedEmployee.name}님의 전체 전화번호를 등록합니다. 태블릿 출퇴근에는 뒷 4자리, 휴가 신청에는 뒷 8자리가 사용됩니다.</p><label>휴대전화 번호<input name="phone" inputMode="tel" placeholder="예: 01012345678" autoFocus required/></label><button className="submit">전화번호 저장</button></form></Modal>}
    {modal === 'invite' && <Modal title="직원 초대" onClose={() => setModal(null)}><p className="modal-text">직원이 회원가입 후 받은 고유번호를 입력해 주세요. 직원이 초대를 수락하면 사업장에 연결됩니다.</p><form onSubmit={sendInvite}><label>직원 고유번호<input name="employeeCode" placeholder="예: A1B2C3D4E5" autoComplete="off" required/></label><div className="form-row"><label>부서<input name="department" placeholder="예: 매장팀"/></label><label>직책<input name="jobTitle" placeholder="예: 바리스타"/></label></div><button className="submit">초대 발송</button></form></Modal>}
    {modal === 'leave' && <Modal title="휴가 요청 검토" onClose={() => setModal(null)}><div className="request-detail"><Avatar name={selectedLeave.employee} color="purple"/><div><b>{selectedLeave.employee}님의 {selectedLeave.type} 신청</b><p>{selectedLeave.date} · {selectedLeave.amount}</p></div></div><label className="note">관리자 메모<textarea placeholder="승인 메모를 남길 수 있어요."/></label><div className="modal-actions"><button className="reject" onClick={() => reviewLeave('반려')}>반려</button><button className="submit" onClick={() => reviewLeave('승인 완료')}>승인하기</button></div></Modal>}
    {modal === 'leaveRequest' && <Modal title="휴가 신청" onClose={() => setModal(null)}><form onSubmit={saveLeaveRequest}><label>휴가 종류<select name="type" defaultValue="연차"><option>연차</option><option>오전 반차</option><option>오후 반차</option><option>시간 휴가</option></select></label><div className="form-row"><label>시작일<input name="startsAt" type="date" defaultValue="2026-08-14" required/></label><label>종료일<input name="endsAt" type="date" defaultValue="2026-08-14" required/></label></div><label>사유 (선택)<textarea name="reason" placeholder="휴가 사유를 간단히 남겨 주세요."/></label><button className="submit">휴가 신청하기</button></form></Modal>}
    {modal === 'schedule' && canManageSchedule && <Modal title={authContext.isOrganizationOwner ? '근무 일정 등록' : '근무 일정 승인 요청'} onClose={() => setModal(null)}><ScheduleRegistrationForm employees={employees} schedules={schedules} leaveRequests={leaveRequests} organizationId={authContext.membership?.organization_id} onSave={saveScheduleSelection} requiresApproval={!authContext.isOrganizationOwner} /></Modal>}
    {modal === 'scheduleGrid' && canManageSchedule && <Modal title="월간 스케줄 편집표" variant="monthly-schedule-modal" onClose={() => setModal(null)}><MonthlyScheduleEditor employees={employees} scheduleByDate={schedules} leaveRequests={leaveRequests} organizationId={authContext.membership?.organization_id} onSave={saveMonthlyScheduleChanges} onClose={() => setModal(null)} requiresApproval={!authContext.isOrganizationOwner}/></Modal>}
    {modal?.type === 'scheduleEdit' && <Modal title="근무 일정 수정" onClose={() => setModal(null)}><ScheduleEditForm schedule={modal.schedule} onSave={updateSchedule} onDelete={removeSchedule}/></Modal>}
    {modal?.type === 'employeeDetail' && <Modal title="직원 상세 정보" variant="employee-detail-modal" onClose={() => setModal(null)}>{(() => { const employee = employees.find(item => item.id === modal.staffId) || selectedEmployee; return <><EmployeeDetail employee={employee} schedules={schedules} leaveRequests={leaveRequests} onBack={() => setModal(null)} setModal={setModal} onNavigate={id => { setModal(null); navigateManager(id); }} onRefresh={refreshWorkforceInPlace} canViewPayroll={canViewPayroll} canManageSchedule={canManageSchedule}/>{authContext.isOrganizationOwner && <StaffAvatarUploader profile={employee} onSaved={refreshWorkforceInPlace}/>}</>; })()}</Modal>}
    {modal === 'attendance' && <Modal title="오늘 출퇴근 현황" onClose={() => setModal(null)}><p className="modal-text">총 23명 중 18명이 출근했습니다. 미출근 직원 2명과 지각 직원 1명을 확인해 주세요.</p><button className="submit" onClick={() => {setModal(null);setActive('attendance')}}>출퇴근 관리로 이동</button></Modal>}
    {modal === 'more' && <Modal title="관리 메뉴" variant="more-sheet" onClose={() => setModal(null)}><div className="more-menu more-menu-scroll">{permittedNav.slice(3).map(([id, label, icon]) => <button key={id} onClick={() => {setModal(null);setActive(id)}}><i>{icon}</i><span>{label}</span><b>›</b></button>)}</div></Modal>}
  </div>;
}

createRoot(document.getElementById('root')).render(window.location.pathname === '/tablet' ? <TabletDeviceApp/> : <App/>);
