import { createHash } from 'node:crypto';
import { authorizeFinance, financeError, financeRest, financeServerConfigured, methodNotAllowed } from './_finance-server.js';
import { analyzeReviewsWithLlm } from './_review-ai.js';

const hashReview = item => createHash('sha256').update(`${item.rating ?? ''}|${String(item.content || '').trim()}`).digest('hex');

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '리뷰 분석 서버 설정이 필요합니다.' });
  const organizationId = req.method === 'GET' ? req.query.organizationId : req.body?.organizationId;
  const auth = await authorizeFinance(req, organizationId);
  if (!auth) return res.status(401).json({ ok: false, error: '리뷰를 확인할 관리자 권한이 필요합니다.' });
  try {
    if (req.method === 'GET') {
      const analyses = await financeRest(`timefit_user_feedback_analyses?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&order=analyzed_at.desc&limit=1000`);
      return res.status(200).json({ ok: true, analyses });
    }
    const requestedIds = Array.isArray(req.body?.feedbackItemIds) ? req.body.feedbackItemIds.filter(Boolean).slice(0, 50) : [];
    const idFilter = requestedIds.length ? `&id=in.(${requestedIds.map(encodeURIComponent).join(',')})` : '';
    const reviews = await financeRest(`timefit_user_feedback_items?organization_id=eq.${encodeURIComponent(organizationId)}&source=eq.naver&kind=eq.review${idFilter}&select=id,content,rating,updated_at&order=occurred_at.desc&limit=50`);
    if (!reviews.length) return res.status(200).json({ ok: true, available: true, processed: 0, skipped: 0 });
    const existing = await financeRest(`timefit_user_feedback_analyses?organization_id=eq.${encodeURIComponent(organizationId)}&feedback_item_id=in.(${reviews.map(item => encodeURIComponent(item.id)).join(',')})&select=feedback_item_id,input_hash`);
    const hashes = new Map(reviews.map(item => [String(item.id), hashReview(item)]));
    const existingHashes = new Map(existing.map(item => [String(item.feedback_item_id), item.input_hash]));
    const pending = reviews.filter(item => existingHashes.get(String(item.id)) !== hashes.get(String(item.id)));
    if (!pending.length) return res.status(200).json({ ok: true, available: true, processed: 0, skipped: reviews.length });
    const result = await analyzeReviewsWithLlm(pending);
    if (!result.available) return res.status(200).json({ ok: true, available: false, processed: 0, skipped: reviews.length });
    const now = new Date().toISOString();
    const rows = result.analyses.map(item => ({
      organization_id: organizationId, feedback_item_id: item.feedbackItemId,
      sentiment: item.sentiment, sentiment_score: item.sentimentScore,
      urgency: item.urgency, summary: item.summary, mentions: item.mentions,
      model: result.model, model_version: 'naver-food-v1', input_hash: hashes.get(item.feedbackItemId), analyzed_at: now,
    }));
    if (rows.length) await financeRest('timefit_user_feedback_analyses?on_conflict=feedback_item_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
    return res.status(200).json({ ok: true, available: true, processed: rows.length, skipped: reviews.length - pending.length, pending: Math.max(0, pending.length - rows.length) });
  } catch (error) { return financeError(res, error, '리뷰 AI 분석을 완료하지 못했습니다.'); }
}
