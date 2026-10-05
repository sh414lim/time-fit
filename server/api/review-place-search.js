import { authorizeFinance, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { reviewCollectorConfigured, reviewCollectorRequest } from './_review-collector.js';

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!financeServerConfigured() || !reviewCollectorConfigured()) return res.status(503).json({ ok: false, error: '리뷰 수집 서버 설정이 필요합니다.' });
  const organizationId = String(req.body?.organizationId || '');
  const query = String(req.body?.query || '').trim();
  const auth = await authorizeFinance(req, organizationId, { ownerOnly: true });
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '회사 소유자 권한이 필요합니다.' });
  if (query.length < 2 || query.length > 100) return res.status(400).json({ ok: false, error: '플레이스 검색어를 2~100자로 입력해 주세요.' });
  try {
    const payload = await reviewCollectorRequest('/v1/naver/search', { method: 'POST', body: { query, limit: 10 }, timeoutMs: 35000 });
    return res.status(200).json({ ok: true, places: payload.places || [] });
  } catch (error) {
    return res.status(error.name === 'AbortError' ? 504 : 502).json({ ok: false, error: '네이버 플레이스 검색을 완료하지 못했습니다.' });
  }
}
