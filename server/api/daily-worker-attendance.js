import { createHmac } from 'node:crypto';
import { encryptSecret } from './_integration-crypto.js';

const POLICY_VERSION = 'daily-worker-privacy-v1-2026-10-18';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_ERRORS = new Set([
  'daily_worker_invalid_payload',
  'tablet_device_not_active',
  'tablet_access_denied',
  'daily_worker_identity_conflict',
  'daily_worker_already_checked_in',
  'daily_worker_open_attendance_not_found',
  'daily_worker_additional_verification_required',
  'daily_worker_already_checked_out',
]);

const digits = value => String(value || '').replace(/\D/g, '');

export function normalizeKoreanMobile(value) {
  let raw = digits(value);
  if (raw.startsWith('82')) raw = `0${raw.slice(2)}`;
  if (!/^01[016789][0-9]{7,8}$/.test(raw)) throw new Error('daily_worker_invalid_phone');
  return { e164: `+82${raw.slice(1)}`, digits: raw, last4: raw.slice(-4), last8: raw.slice(-8) };
}

export function normalizeResidentRegistrationNumber(value) {
  const raw = digits(value);
  if (!/^[0-9]{13}$/.test(raw) || !/^[1-8]$/.test(raw[6])) throw new Error('daily_worker_invalid_resident');
  const century = '1256'.includes(raw[6]) ? 1900 : 2000;
  const year = century + Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('daily_worker_invalid_resident');
  }
  return { digits: raw, mask: `${raw.slice(0, 6)}-${raw.slice(6, 7)}******` };
}

function identityKey() {
  const encryptionKey = Buffer.from(String(process.env.INTEGRATION_ENCRYPTION_KEY || ''), 'base64');
  if (encryptionKey.length !== 32) throw new Error('daily_worker_secure_storage_unavailable');
  return createHmac('sha256', encryptionKey).update('timefit:daily-worker:identity-hmac:v1').digest();
}

export function dailyWorkerIdentityHmac(value) {
  return createHmac('sha256', identityKey()).update(String(value), 'utf8').digest('hex');
}

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function publicError(payload) {
  const message = String(payload?.message || payload?.error || '');
  return [...KNOWN_ERRORS].find(code => message.includes(code)) || 'daily_worker_failed';
}

function errorStatus(code) {
  if (code === 'tablet_device_not_active' || code === 'tablet_access_denied') return 403;
  if (code === 'daily_worker_open_attendance_not_found') return 404;
  if (code === 'daily_worker_additional_verification_required' || code === 'daily_worker_identity_conflict' || code === 'daily_worker_already_checked_in' || code === 'daily_worker_already_checked_out') return 409;
  if (code === 'daily_worker_secure_storage_unavailable') return 503;
  return 400;
}

async function callRpc(name, body) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = publicError(payload);
    throw Object.assign(new Error(code), { status: errorStatus(code) });
  }
  return payload;
}

async function storeEncryptedPhone(workerId, phoneDigits) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_short_term_workers?id=eq.${encodeURIComponent(workerId)}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ encrypted_phone_number: encryptSecret(phoneDigits) }),
  });
  if (!response.ok) throw new Error('daily_worker_secure_storage_unavailable');
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.INTEGRATION_ENCRYPTION_KEY) {
    return res.status(503).json({ ok: false, error: 'daily_worker_secure_storage_unavailable' });
  }
  try {
    const action = String(req.body?.action || '');
    const deviceToken = String(req.body?.deviceToken || '').trim();
    const requestKey = String(req.body?.requestKey || '').trim();
    if (!['check_in', 'check_out'].includes(action) || deviceToken.length < 20 || deviceToken.length > 256 || !UUID_PATTERN.test(requestKey)) {
      return res.status(400).json({ ok: false, error: 'daily_worker_invalid_payload' });
    }
    const phone = normalizeKoreanMobile(req.body?.phone);
    const phoneHmac = dailyWorkerIdentityHmac(phone.e164);
    let data;
    if (action === 'check_in') {
      const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name) || req.body?.privacyConsent !== true) {
        return res.status(400).json({ ok: false, error: req.body?.privacyConsent === true ? 'daily_worker_invalid_name' : 'daily_worker_privacy_consent_required' });
      }
      const resident = normalizeResidentRegistrationNumber(req.body?.residentRegistrationNumber);
      data = await callRpc('timefit_user_daily_worker_check_in', {
        p_device_token: deviceToken,
        p_name: name,
        p_phone_e164: phone.e164,
        p_phone_hmac: phoneHmac,
        p_phone_last4: phone.last4,
        p_phone_last8: phone.last8,
        p_resident_ciphertext: encryptSecret(resident.digits),
        p_resident_mask: resident.mask,
        p_resident_hmac: dailyWorkerIdentityHmac(resident.digits),
        p_policy_version: POLICY_VERSION,
        p_request_key: requestKey,
      });
      await storeEncryptedPhone(data?.workerId, phone.digits);
    } else {
      data = await callRpc('timefit_user_daily_worker_check_out', {
        p_device_token: deviceToken,
        p_phone_hmac: phoneHmac,
        p_request_key: requestKey,
      });
    }
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    const code = KNOWN_ERRORS.has(error?.message) || String(error?.message || '').startsWith('daily_worker_') ? error.message : 'daily_worker_failed';
    return res.status(error?.status || errorStatus(code)).json({ ok: false, error: code });
  }
}
