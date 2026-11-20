import { authorizeFinance, financeError, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { loadLatestProfitSnapshot } from './_profit-store.js';
import { profitSnapshotKey, rebuildProfitSnapshot, snapshotRowToOverview } from './_profit-overview.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 처리 서버 설정이 필요합니다.' });
  const organizationId = String(req.query.organizationId || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to || daysBetween(from, to) > 370) return res.status(400).json({ ok: false, error: '조회 기간은 최대 370일 이내로 선택해 주세요.' });
  const auth = await authorizeFinance(req, organizationId, { permissionsAny: ['finance.view', 'expense.manage', 'expense.card.manage'] });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '재무 조회 권한이 필요합니다.' });
  try {
    const force = String(req.query.refresh || '') === '1';
    const snapshot = force ? null : await loadLatestProfitSnapshot({ organizationId, snapshotKey: profitSnapshotKey({ from, to }) });
    const fresh = snapshot && Date.now() - Date.parse(snapshot.generated_at) < 30 * 60 * 1000;
    const overview = fresh ? snapshotRowToOverview(snapshot) : await rebuildProfitSnapshot({ organizationId, from, to });
    return res.status(200).json({ ok: true, source: fresh ? 'snapshot' : 'database_rebuild', overview });
  } catch (error) {
    return financeError(res, error, '손익 현황을 불러오지 못했습니다.');
  }
}
