import { authorizeOrganizationMember, financeError, financeRest, financeServerConfigured, methodNotAllowed, serviceHeaders } from './_finance-server.js';
import { extractReceiptWithLlm, mergeReceiptExtractions } from './_receipt-llm.js';
import { createHash } from 'node:crypto';

const extractAmount = text => {
  const labelled = [...text.matchAll(/(?:합계|결제금액|받을금액|총액)\s*[:：]?\s*[₩￦]?\s*([0-9][0-9,]*)/gi)].map(match => Number(match[1].replace(/,/g, ''))).filter(Number.isFinite);
  if (labelled.length) return labelled.at(-1);
  const amounts = [...text.matchAll(/[₩￦]\s*([0-9][0-9,]*)/g)].map(match => Number(match[1].replace(/,/g, ''))).filter(amount => amount > 0);
  return amounts.length ? Math.max(...amounts) : null;
};

const extractDate = text => {
  const match = text.match(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
};

export const structuredReceipt = text => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const businessNumber = text.match(/(?:사업자(?:등록)?번호|사업자)\s*[:：]?\s*(\d{3})[- ]?(\d{2})[- ]?(\d{5})/i);
  const approvalNumber = text.match(/(?:승인번호|승인 No\.?)\s*[:：]?\s*([0-9A-Za-z-]{4,})/i);
  const last4 = text.match(/(?:카드번호|카드)\s*[:：]?\s*(?:[*Xx#-]+\s*)?(\d{4})(?!\d)/i);
  return {
    merchantName: lines.find(line => !/영수증|매출전표|사업자|대표|전화|주소/i.test(line) && /[가-힣A-Za-z]/.test(line)) || null,
    transactionDate: extractDate(text), totalAmount: extractAmount(text),
    merchantBusinessNumber: businessNumber ? `${businessNumber[1]}-${businessNumber[2]}-${businessNumber[3]}` : null,
    approvalNumber: approvalNumber?.[1] || null, cardLast4: last4?.[1] || null,
  };
};

export const receiptFingerprint = receipt => {
  if (!receipt?.transactionDate || !Number.isFinite(Number(receipt.totalAmount))) return null;
  const merchantIdentity = String(receipt.merchantBusinessNumber || receipt.approvalNumber || receipt.merchantName || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  if (!merchantIdentity) return null;
  const identity = [receipt.transactionDate, Number(receipt.totalAmount), merchantIdentity, String(receipt.approvalNumber || ''), String(receipt.cardLast4 || '')].join('|');
  return createHash('sha256').update(identity).digest('hex');
};

const normalizedRuleValue = value => String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

export function matchingClassificationRule(receipt, rules = []) {
  const businessNumber = normalizedRuleValue(receipt.merchantBusinessNumber);
  const merchantName = normalizedRuleValue(receipt.merchantName);
  return rules.filter(rule => rule.is_active !== false).sort((a, b) => Number(b.match_type === 'merchant_business_number') - Number(a.match_type === 'merchant_business_number') || Number(b.priority || 0) - Number(a.priority || 0)).find(rule => rule.match_type === 'merchant_business_number' ? businessNumber && rule.match_value === businessNumber : merchantName && rule.match_value === merchantName) || null;
}

export const matchScore = (receipt, transaction) => {
  const breakdown = {};
  if (receipt.totalAmount && Number(transaction.net_amount) === receipt.totalAmount) breakdown.amount = 45;
  if (receipt.transactionDate && String(transaction.approved_at || '').slice(0, 10) === receipt.transactionDate) breakdown.date = 25;
  if (receipt.approvalNumber && transaction.approval_number === receipt.approvalNumber) breakdown.approvalNumber = 25;
  if (receipt.cardLast4 && transaction.card?.last4 === receipt.cardLast4) breakdown.cardLast4 = 5;
  return { score: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
};

export function receiptRetryBlocker(previousRuns = [], hasExpenseSource = false) {
  if (previousRuns.some(run => ['queued','processing'].includes(run.status))) return 'processing';
  if (previousRuns.length >= 5) return 'limit';
  if (hasExpenseSource) return 'already_processed';
  return null;
}

async function downloadDocument(path) {
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/authenticated/timefit-finance-documents/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: serviceHeaders() });
  if (!response.ok) throw new Error(`receipt_download_${response.status}`);
  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

async function visionText(content) {
  if (!process.env.GOOGLE_VISION_API_KEY) throw new Error('google_vision_not_configured');
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(process.env.GOOGLE_VISION_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ image: { content }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.responses?.[0]?.error) throw new Error(body.responses?.[0]?.error?.message || `google_vision_${response.status}`);
  return body.responses?.[0]?.fullTextAnnotation?.text || body.responses?.[0]?.textAnnotations?.[0]?.description || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  if (!financeServerConfigured()) return res.status(503).json({ ok: false, error: '금융 처리 서버 설정이 필요합니다.' });
  const { organizationId, documentId } = req.body || {};
  const auth = await authorizeOrganizationMember(req, organizationId);
  if (!auth) return res.status(req.headers.authorization ? 403 : 401).json({ ok: false, error: '사업장 구성원 인증이 필요합니다.' });
  let runId;
  try {
    const documents = await financeRest(`timefit_user_finance_documents?id=eq.${encodeURIComponent(documentId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=*`);
    const document = documents[0];
    if (!document) return res.status(404).json({ ok: false, error: '영수증 원본을 찾을 수 없습니다.' });
    if (auth.role !== 'manager' && document.uploaded_by !== auth.user.id) return res.status(403).json({ ok: false, error: '본인이 제출한 영수증만 처리할 수 있습니다.' });
    if (!String(document.mime_type || '').startsWith('image/')) return res.status(400).json({ ok: false, error: 'JPG, PNG, WebP 또는 HEIC 영수증 이미지를 선택해 주세요.' });
    const previousRuns = await financeRest(`timefit_user_expense_processing_runs?document_id=eq.${encodeURIComponent(documentId)}&select=id,status,created_at&order=created_at.desc&limit=6`);
    const existingSources = await financeRest(`timefit_user_expense_sources?organization_id=eq.${encodeURIComponent(organizationId)}&source_type=eq.receipt&source_id=eq.${encodeURIComponent(documentId)}&select=expense_id&limit=1`);
    const retryBlocker = receiptRetryBlocker(previousRuns, existingSources.length > 0);
    if (retryBlocker === 'processing') return res.status(409).json({ ok: false, error: '이미 영수증을 분석하고 있습니다.' });
    if (retryBlocker === 'limit') return res.status(409).json({ ok: false, error: '자동 재분석 횟수를 초과했습니다. 원본과 입력값을 직접 확인해 주세요.' });
    if (retryBlocker === 'already_processed') return res.status(409).json({ ok: false, error: '이미 지출 원장에 반영된 영수증입니다.' });
    const runs = await financeRest('timefit_user_expense_processing_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ organization_id: organizationId, document_id: documentId, status: 'processing', ocr_model: 'DOCUMENT_TEXT_DETECTION', extractor_version: 'receipt-regex-v1', started_at: new Date().toISOString(), created_by: auth.user.id }]) });
    runId = runs[0].id;
    await financeRest(`timefit_user_finance_documents?id=eq.${encodeURIComponent(documentId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ processing_status: 'processing', processing_error: null }) });
    const text = await visionText(await downloadDocument(document.storage_path));
    if (!text.trim()) throw new Error('receipt_text_not_found');
    const ruleBased = structuredReceipt(text);
    let llmResult = null; let llmError = null;
    try { llmResult = await extractReceiptWithLlm(text); } catch (error) { llmError = error; }
    let extracted = mergeReceiptExtractions(ruleBased, llmResult);
    if (!extracted.transactionDate || !extracted.totalAmount) throw new Error('receipt_required_fields_missing');
    const rules = await financeRest(`timefit_user_expense_classification_rules?organization_id=eq.${encodeURIComponent(organizationId)}&is_active=eq.true&select=id,match_type,match_value,category,default_reason,priority,is_active,hit_count&order=priority.desc&limit=200`);
    const classificationRule = matchingClassificationRule(extracted, rules);
    if (classificationRule) extracted = { ...extracted, category: classificationRule.category, appliedRuleId: classificationRule.id, appliedRuleReason: classificationRule.default_reason || null };
    const fingerprint = receiptFingerprint(extracted);
    if (fingerprint) {
      const duplicates = await financeRest(`timefit_user_finance_documents?organization_id=eq.${encodeURIComponent(organizationId)}&receipt_fingerprint=eq.${encodeURIComponent(fingerprint)}&id=neq.${encodeURIComponent(documentId)}&select=id,processing_status&order=created_at.asc&limit=1`);
      if (duplicates.length) {
        const sources = await financeRest(`timefit_user_expense_sources?organization_id=eq.${encodeURIComponent(organizationId)}&source_type=eq.receipt&source_id=eq.${encodeURIComponent(duplicates[0].id)}&select=expense_id&limit=1`);
        if (sources.length) {
          const finishedAt = new Date().toISOString();
          await financeRest('timefit_user_expense_sources', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ organization_id: organizationId, expense_id: sources[0].expense_id, source_type: 'receipt', source_id: documentId, is_primary: false, match_reason: { duplicateFingerprint: fingerprint, duplicateOfDocumentId: duplicates[0].id } }]) });
          await financeRest(`timefit_user_finance_documents?id=eq.${encodeURIComponent(documentId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ processing_status: 'matched', document_date: extracted.transactionDate, extracted_data: extracted, ocr_text: text.slice(0, 50000), receipt_fingerprint: fingerprint, duplicate_of_document_id: duplicates[0].id, processed_at: finishedAt }) });
          await financeRest(`timefit_user_expense_processing_runs?id=eq.${encodeURIComponent(runId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'succeeded', extraction_provider: extracted.extractionProvider, extraction_model: llmResult?.model || null, input_tokens: llmResult?.usage?.input_tokens || null, output_tokens: llmResult?.usage?.output_tokens || null, fallback_used: !llmResult, error_code: 'duplicate_receipt_linked', finished_at: finishedAt }) });
          return res.status(200).json({ ok: true, duplicateReceipt: true, documentId, duplicateOfDocumentId: duplicates[0].id, expenseId: sources[0].expense_id, extracted, candidates: [] });
        }
      }
    }
    const from = `${extracted.transactionDate}T00:00:00+09:00`; const toDate = new Date(`${extracted.transactionDate}T00:00:00+09:00`); toDate.setDate(toDate.getDate() + 1);
    const transactions = await financeRest(`timefit_user_card_transaction_groups?organization_id=eq.${encodeURIComponent(organizationId)}&approved_at=gte.${encodeURIComponent(from)}&approved_at=lt.${encodeURIComponent(toDate.toISOString())}&select=*,card:timefit_user_corporate_cards(last4)&limit=100`);
    const candidates = transactions.map(item => ({ transaction: item, ...matchScore(extracted, item) })).filter(item => item.score >= 45).sort((a, b) => b.score - a.score).slice(0, 3);
    const expenses = await financeRest('timefit_user_expenses', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ organization_id: organizationId, transaction_date: extracted.transactionDate, supply_amount: extracted.supplyAmount, vat_amount: extracted.vatAmount, total_amount: extracted.totalAmount, merchant_name: extracted.merchantName, merchant_business_number: extracted.merchantBusinessNumber, category: extracted.category, reason: document.submission_reason || extracted.appliedRuleReason || null, staff_id: document.submitted_by_staff_id || null, classification_rule_id: classificationRule?.id || null, status: 'review_required', source_confidence: Math.max(Number(extracted.confidence || 0), candidates[0] ? candidates[0].score / 100 : 0), created_by: auth.user.id }]) });
    const expense = expenses[0];
    if (classificationRule) await financeRest(`timefit_user_expense_classification_rules?id=eq.${encodeURIComponent(classificationRule.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ hit_count: Number(classificationRule.hit_count || 0) + 1, last_applied_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    await financeRest('timefit_user_expense_sources', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ organization_id: organizationId, expense_id: expense.id, source_type: 'receipt', source_id: documentId, is_primary: true, match_reason: { extractorVersion: 'receipt-regex-v1' } }]) });
    for (const candidate of candidates) await financeRest('timefit_user_expense_matches', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ organization_id: organizationId, expense_id: expense.id, transaction_group_id: candidate.transaction.id, document_id: documentId, status: 'suggested', score: candidate.score, score_breakdown: candidate.breakdown }]) });
    const finishedAt = new Date().toISOString();
    await financeRest(`timefit_user_finance_documents?id=eq.${encodeURIComponent(documentId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ processing_status: candidates[0]?.score >= 95 ? 'matched' : 'review_required', document_date: extracted.transactionDate, extracted_data: extracted, ocr_text: text.slice(0, 50000), receipt_fingerprint: fingerprint, processed_at: finishedAt }) });
    await financeRest(`timefit_user_expense_processing_runs?id=eq.${encodeURIComponent(runId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'succeeded', extraction_provider: extracted.extractionProvider, extraction_model: llmResult?.model || null, input_tokens: llmResult?.usage?.input_tokens || null, output_tokens: llmResult?.usage?.output_tokens || null, fallback_used: !llmResult, error_code: llmError ? String(llmError.message || 'llm_fallback').slice(0, 160) : null, finished_at: finishedAt }) });
    return res.status(200).json({ ok: true, documentId, expenseId: expense.id, extracted, candidates: candidates.map(item => ({ transactionGroupId: item.transaction.id, score: item.score, scoreBreakdown: item.breakdown })) });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    if (runId) await financeRest(`timefit_user_expense_processing_runs?id=eq.${encodeURIComponent(runId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'failed', error_code: String(error.message || 'receipt_processing_failed').slice(0, 160), finished_at: finishedAt }) }).catch(() => {});
    if (documentId) await financeRest(`timefit_user_finance_documents?id=eq.${encodeURIComponent(documentId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ processing_status: 'failed', processing_error: String(error.message || 'receipt_processing_failed').slice(0, 300), processed_at: finishedAt }) }).catch(() => {});
    return financeError(res, error, '영수증을 자동 분석하지 못했습니다. 원본은 안전하게 보관됐습니다.');
  }
}
