import { decryptSecret } from './_integration-crypto.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const serviceHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
});

const formatPhone = value => {
  const raw = String(value || '').replace(/\D/g, '');
  if (raw.length === 11) return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
  if (raw.length === 10) return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
  return raw;
};

const formatResident = value => {
  const raw = String(value || '').replace(/\D/g, '');
  return raw.length === 13 ? `${raw.slice(0, 6)}-${raw.slice(6)}` : raw;
};

async function authorizedManager(token, organizationId) {
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) throw Object.assign(new Error('로그인이 만료됐습니다.'), { status: 401 });
  const user = await userResponse.json();
  const membershipResponse = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/timefit_user_memberships?organization_id=eq.${encodeURIComponent(organizationId)}&user_id=eq.${encodeURIComponent(user.id)}&role=eq.manager&select=organization_id`,
    { headers: serviceHeaders() },
  );
  if (!membershipResponse.ok || !(await membershipResponse.json()).length) {
    throw Object.assign(new Error('관리자 권한이 필요합니다.'), { status: 403 });
  }
}

async function loadRecords({ organizationId, recordId, from, to }) {
  const params = new URLSearchParams({
    organization_id: `eq.${organizationId}`,
    select: 'id,organization_id,short_term_worker_id,work_date,checked_in_at,checked_out_at,status,needs_review,updated_at',
    order: 'checked_in_at.asc',
  });
  if (recordId) params.set('id', `eq.${recordId}`);
  if (from) params.set('work_date', `gte.${from}`);
  if (to) params.append('work_date', `lte.${to}`);
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_short_term_attendance_records?${params}`, { headers: serviceHeaders() });
  if (!response.ok) throw new Error('단기직원 근무기록을 불러오지 못했습니다.');
  return response.json();
}

async function loadWorkers(workerIds) {
  if (!workerIds.length) return [];
  const ids = `(${workerIds.join(',')})`;
  const params = new URLSearchParams({
    id: `in.${ids}`,
    select: 'id,display_name,phone_last8,encrypted_phone_number,encrypted_resident_registration_number,resident_registration_mask',
  });
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/timefit_user_short_term_workers?${params}`, { headers: serviceHeaders() });
  if (!response.ok) throw new Error('단기직원 신원정보를 불러오지 못했습니다.');
  return response.json();
}

export default async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'no-store, private');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.INTEGRATION_ENCRYPTION_KEY) {
    return res.status(503).json({ ok: false, error: '단기직원 상세정보 서비스를 사용할 수 없습니다.' });
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const organizationId = String(req.query?.organizationId || '');
  const recordId = String(req.query?.recordId || '');
  const from = String(req.query?.from || '');
  const to = String(req.query?.to || '');
  if (!token || !UUID_PATTERN.test(organizationId) || (recordId && !UUID_PATTERN.test(recordId))) {
    return res.status(400).json({ ok: false, error: '조회 조건을 확인해 주세요.' });
  }
  try {
    await authorizedManager(token, organizationId);
    const records = await loadRecords({ organizationId, recordId, from, to });
    const workerIds = [...new Set(records.map(record => record.short_term_worker_id))];
    const workers = new Map((await loadWorkers(workerIds)).map(worker => [worker.id, worker]));
    const result = records.map(record => {
      const worker = workers.get(record.short_term_worker_id);
      if (!worker) throw new Error('단기직원 정보를 찾지 못했습니다.');
      const fallbackPhone = worker.phone_last8 ? `010${worker.phone_last8}` : '';
      const phone = worker.encrypted_phone_number ? decryptSecret(worker.encrypted_phone_number) : fallbackPhone;
      return {
        ...record,
        display_name: worker.display_name,
        phone_number: formatPhone(phone),
        ...(recordId ? {
          resident_registration_number: formatResident(decryptSecret(worker.encrypted_resident_registration_number)),
        } : {}),
      };
    });
    return res.status(200).json({ ok: true, records: result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || '단기직원 상세정보를 불러오지 못했습니다.' });
  }
}
