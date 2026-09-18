import { authorizeFinance, financeRest, financeServerConfigured } from './_finance-server.js';
import { addDays, kstDate, lastCompleteWeek, validDate, weeklySalesFromDaily } from '../shared/operations.js';

// Never silently truncate a busy store at PostgREST's row limit.
export async function readAll(path, read = financeRest) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const page = await read(`${path}&limit=500&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error('Invalid source response');
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  throw new Error('Source exceeds safe aggregation limit');
}

export async function loadWeeklyFeedback(organizationId, range) {
  const snapshot = await financeRest('rpc/timefit_user_read_weekly_sales', {
    method: 'POST', body: JSON.stringify({ p_organization_id: organizationId, p_from: range.previousFrom, p_to: range.to }),
  });
  return weeklySalesFromDaily(snapshot, range);
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '운영 요약 서버 설정이 필요합니다.' });
  const { organizationId, scope = 'weekly', from } = req.query || {};
  if (typeof organizationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(organizationId) || !['weekly', 'tasks', 'cards'].includes(scope)) return res.status(400).json({ ok: false, error: '조회 조건을 확인해 주세요.' });
  try {
    const auth = await authorizeFinance(req, organizationId, { ownerOnly: true });
    if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '최고관리자 권한이 필요합니다.' });
    const today = kstDate();
    const org = `organization_id=eq.${encodeURIComponent(organizationId)}`;
    if (scope === 'weekly') {
      if (from !== undefined && (!validDate(from) || new Date(`${from}T00:00:00Z`).getUTCDay() !== 1 || addDays(from, 6) >= today)) return res.status(400).json({ ok: false, error: '마감된 주의 월요일을 선택해 주세요.' });
      const range = from ? { from, to: addDays(from, 6), previousFrom: addDays(from, -7), previousTo: addDays(from, -1) } : lastCompleteWeek(today);
      return res.status(200).json({ ok: true, data: await loadWeeklyFeedback(organizationId, range) });
    }
    const month = req.query.month || today.slice(0, 7);
    if (!validDate(`${month}-01`)) return res.status(400).json({ ok: false, error: '조회 월을 확인해 주세요.' });
    const start = `${month}-01`, end = addDays(start, 32).slice(0, 7) + '-01';
    const cards = await readAll(`timefit_user_card_transaction_groups?${org}&reconciliation_status=eq.unreviewed&net_amount=gt.0&approved_at=gte.${encodeURIComponent(`${start}T00:00:00+09:00`)}&approved_at=lt.${encodeURIComponent(`${end}T00:00:00+09:00`)}&select=id,merchant_name,approved_at,net_amount,status,reconciliation_status,card:timefit_user_corporate_cards(nickname,last4)&order=approved_at.asc,id.asc`);
    if (scope === 'cards') return res.status(200).json({ ok: true, data: { month, cards } });
    const drafts = await financeRest(`timefit_user_payroll_drafts?${org}&settlement_month=eq.${start}&select=updated_at,status&limit=1`);
    // Changes in old records are visible through updated_at, not clock-out time.
    const latest = await financeRest(`timefit_user_attendance_records?${org}&work_date=gte.${start}&work_date=lt.${end}&select=updated_at&order=updated_at.desc&limit=1`);
    return res.status(200).json({ ok: true, data: { month, cardCount: cards.length, cardAmount: cards.reduce((sum, row) => sum + Number(row.net_amount), 0), draft: drafts[0] || null, attendanceChanged: Boolean(drafts[0] && latest[0]?.updated_at > drafts[0].updated_at) } });
  } catch {
    return res.status(502).json({ ok: false, error: '운영 요약을 불러오지 못했습니다. 다시 시도해 주세요.' });
  }
}
