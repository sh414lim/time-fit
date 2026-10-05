import { authorizeFinance, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { reviewCollectorConfigured, reviewCollectorRequest } from './_review-collector.js';

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res);
  if (!financeServerConfigured() || !reviewCollectorConfigured()) return res.status(503).json({ ok: false, error: '리뷰 수집 서버 설정이 필요합니다.' });
  const organizationId = String(req.method === 'GET' ? req.query?.organizationId : req.body?.organizationId || '');
  const auth = await authorizeFinance(req, organizationId, { ownerOnly: true });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '회사 소유자 권한이 필요합니다.' });
  try {
    if (req.method === 'POST') {
      const { placeId, placeName, address, searchQuery, limit = 5000 } = req.body || {};
      if (!/^\d+$/.test(String(placeId || ''))) return res.status(400).json({ ok: false, error: '수집할 플레이스를 선택해 주세요.' });
      const payload = await reviewCollectorRequest('/v1/naver/collect', { method: 'POST', timeoutMs: 10000, body: { organizationId, placeId, placeName, address, searchQuery, limit: Math.max(1, Math.min(Number(limit) || 5000, 5000)) } });
      return res.status(202).json({ ok: true, job: payload.job });
    }
    const jobId = String(req.query?.jobId || '');
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return res.status(400).json({ ok: false, error: '수집 작업 ID를 확인해 주세요.' });
    const payload = await reviewCollectorRequest(`/v1/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 10000 });
    if (payload.job?.organizationId !== organizationId) return res.status(404).json({ ok: false, error: '수집 작업을 찾을 수 없습니다.' });
    return res.status(200).json({ ok: true, job: payload.job });
  } catch (error) {
    return res.status(error.status === 404 ? 404 : error.name === 'AbortError' ? 504 : 502).json({ ok: false, error: '리뷰 수집 작업을 처리하지 못했습니다.' });
  }
}
