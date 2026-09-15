import { authorizeFinance, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { reportData } from './finance-report.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 처리 서버 설정이 필요합니다.' });
  const { organizationId, from, to } = req.query || {};
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  if (!validDate(from) || !validDate(to) || from > to || (new Date(to) - new Date(from)) / 86400000 > 370) {
    return res.status(400).json({ ok: false, error: '조회 기간은 최대 370일 이내로 선택해 주세요.' });
  }
  const auth = await authorizeFinance(req, organizationId, { permissionsAny: ['sales.view', 'sales.sync'] });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '매출 조회 권한이 필요합니다.' });
  try {
    const report = await reportData(organizationId, from, to);
    return res.status(200).json({
      ok: true, organizationId, from, to,
      laborCost: Number(report.actualTotals?.laborCost || 0),
      payrollComplete: Boolean(report.completeness?.payrollComplete),
      laborBasis: report.completeness?.laborBasis || null,
    });
  } catch (error) {
    console.error('Sales labor summary failed', { message: error.message });
    return res.status(502).json({ ok: false, error: '사업장 전체 인건비를 불러오지 못했습니다.' });
  }
}
