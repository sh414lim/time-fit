import { createHash, publicEncrypt, constants } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../_integration-crypto.js';

const CODEF_RESULT_OK = 'CF-00000';
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const tokenCache = new Map();

const environmentBaseUrls = {
  sandbox: 'https://sandbox.codef.io',
  demo: 'https://development.codef.io',
  production: 'https://api.codef.io',
};

export const codefEnvironment = () => {
  const value = String(process.env.CODEF_ENV || 'sandbox').trim().toLowerCase();
  if (!Object.hasOwn(environmentBaseUrls, value)) throw new Error('codef_environment_invalid');
  return value;
};

export const codefBaseUrl = () => environmentBaseUrls[codefEnvironment()];

const codefConfiguration = () => ({
  clientId: process.env.CODEF_CLIENT_ID,
  clientSecret: process.env.CODEF_CLIENT_SECRET,
  publicKey: process.env.CODEF_PUBLIC_KEY,
});

export function codefConfigured({ requirePublicKey = false } = {}) {
  const config = codefConfiguration();
  return Boolean(config.clientId && config.clientSecret && (!requirePublicKey || config.publicKey) && process.env.INTEGRATION_ENCRYPTION_KEY);
}

function codefError(code, message, status = 502) {
  const error = new Error(`codef_${code || 'unknown'}:${message || '요청 실패'}`);
  error.code = code || 'codef_unknown';
  error.status = status;
  return error;
}

function parseCodefBody(text) {
  const candidates = [text];
  try { candidates.push(decodeURIComponent(text)); } catch {}
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch {}
  }
  throw codefError('invalid_response', '응답 JSON을 해석하지 못했습니다.');
}

function assertCodefSuccess(body) {
  const code = body?.result?.code;
  if (code && code !== CODEF_RESULT_OK) throw codefError(code, body?.result?.message || body?.result?.extraMessage);
  return body;
}

async function codefAccessToken() {
  const { clientId, clientSecret } = codefConfiguration();
  if (!clientId || !clientSecret) throw codefError('not_configured', '클라이언트 키가 필요합니다.', 503);
  const cacheKey = `${codefEnvironment()}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached?.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) return cached.value;

  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://oauth.codef.io/oauth/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=read',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw codefError(`oauth_${response.status}`, body.error_description || body.error, response.status);
  const expiresIn = Math.max(60, Number(body.expires_in || 604799));
  tokenCache.set(cacheKey, { value: body.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  return body.access_token;
}

async function callCodef(path, payload, { retryUnauthorized = true } = {}) {
  const response = await fetch(`${codefBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${await codefAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: encodeURIComponent(JSON.stringify(payload)),
  });
  if (response.status === 401 && retryUnauthorized) {
    tokenCache.clear();
    return callCodef(path, payload, { retryUnauthorized: false });
  }
  const body = parseCodefBody(await response.text());
  if (!response.ok) throw codefError(`http_${response.status}`, body?.result?.message, response.status);
  return assertCodefSuccess(body);
}

function rsaEncrypt(value) {
  const publicKey = String(codefConfiguration().publicKey || '').replace(/\s/g, '');
  if (!publicKey) throw codefError('public_key_missing', 'RSA 공개키가 필요합니다.', 503);
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKey.match(/.{1,64}/g)?.join('\n') || publicKey}\n-----END PUBLIC KEY-----`;
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(String(value))).toString('base64');
}

const digits = value => String(value || '').replace(/\D/g, '');
const compact = value => String(value || '').trim();
const integerAmount = value => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed)) : null;
};
const arrayData = body => {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  for (const key of ['resCardList', 'resApprovalList', 'resPurchaseList', 'list']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

function dateTimeKst(date, time = '000000') {
  const ymd = digits(date);
  const hms = digits(time).padEnd(6, '0');
  if (!/^\d{8}$/.test(ymd) || !/^\d{6}$/.test(hms)) return null;
  const value = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}+09:00`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function fingerprint(parts) {
  return createHash('sha256').update(parts.map(compact).join('|')).digest('hex');
}

export function codefCardFingerprint(row, organization = '') {
  return `codef-card-${fingerprint([organization, row?.resCardNo]).slice(0, 32)}`;
}

export function normalizeCodefCards(body, organization = '') {
  return arrayData(body).flatMap((row, sourceIndex) => {
    const cardDigits = digits(row?.resCardNo);
    const last4 = cardDigits.length >= 4 ? cardDigits.slice(-4) : null;
    if (!row?.resCardNo || !last4) return [];
    const issuer = compact(row.resCardCompany || row.resOrganizationName || row.resCompanyName) || '카드사';
    const cardName = compact(row.resCardName) || '법인카드';
    return [{
      providerAssetId: codefCardFingerprint(row, organization),
      issuer,
      displayName: `${cardName} ${last4}`,
      last4,
      status: /휴면|정지|해지|inactive/i.test(compact(row.resSleepYn || row.resCardStatus)) ? 'inactive' : 'active',
      sourceIndex,
    }];
  });
}

function codefEventType(cancelCode) {
  const value = compact(cancelCode);
  if (value === '1') return 'cancellation';
  if (value === '2') return 'partial_cancellation';
  if (value === '3') return 'declined';
  return 'approval';
}

export function normalizeCodefEvents(body, organization = '', providerCardId = null) {
  return arrayData(body).flatMap(row => {
    const occurredAt = dateTimeKst(row.resUsedDate, row.resUsedTime || row.resUsedTime1);
    const amount = integerAmount(row.resUsedAmount ?? row.resAmount ?? row.resUsedKRWAmount);
    if (!occurredAt || amount === null) return [];
    const rowCardId = codefCardFingerprint({ resCardNo: row.resCardNo }, organization);
    if (providerCardId && rowCardId !== providerCardId) return [];
    const eventType = codefEventType(row.resCancelYN);
    const cancelAmount = integerAmount(row.resCancelAmount);
    const normalizedAmount = eventType === 'cancellation' || eventType === 'partial_cancellation' ? (cancelAmount || amount) : amount;
    const approvalNumber = compact(row.resApprovalNo) || null;
    const eventIdentity = [rowCardId, approvalNumber, occurredAt, normalizedAmount, eventType, row.resMemberStoreName, row.resPurchaseDate];
    const providerEventId = compact(row.resTransactionId || row.transactionId) || `codef-event-${fingerprint(eventIdentity)}`;
    const groupKey = approvalNumber
      ? `codef-group-${fingerprint([organization, rowCardId, approvalNumber, row.resOriginalUsedDate || row.resUsedDate]).slice(0, 40)}`
      : `codef-review-${fingerprint([organization, rowCardId, occurredAt, amount, row.resMemberStoreName]).slice(0, 40)}`;
    return [{
      providerEventId,
      groupKey,
      eventType,
      occurredAt,
      amount: normalizedAmount,
      currency: compact(row.resAccountCurrency || row.resCurrency) || 'KRW',
      approvalNumber,
      originalProviderEventId: compact(row.resOriginalTransactionId) || null,
      merchantName: compact(row.resMemberStoreName) || null,
      merchantBusinessNumber: compact(row.resMemberStoreCorpNo) || null,
      vatAmount: integerAmount(row.resVAT),
      acquiredAt: row.resPurchaseYN === '1' ? dateTimeKst(row.resPurchaseDate) : null,
      requiresReview: !approvalNumber,
    }];
  });
}

export function normalizeCodefPurchases(body, organization = '', providerCardId = null) {
  return arrayData(body).flatMap(row => {
    const occurredAt = dateTimeKst(row.resUsedDate, row.resUsedTime || row.resPurchaseTime);
    const acquiredAt = dateTimeKst(row.resPurchaseDate || row.resUsedDate, row.resPurchaseTime || row.resUsedTime);
    const amount = integerAmount(row.resUsedAmount ?? row.resPurchaseAmount ?? row.resAmount);
    if (!occurredAt || !acquiredAt || amount === null) return [];
    const rowCardId = codefCardFingerprint({ resCardNo: row.resCardNo }, organization);
    if (providerCardId && rowCardId !== providerCardId) return [];
    const approvalNumber = compact(row.resApprovalNo) || null;
    const providerEventId = compact(row.resTransactionId || row.transactionId) || `codef-purchase-${fingerprint([rowCardId, approvalNumber, acquiredAt, amount, row.resMemberStoreName])}`;
    const groupKey = approvalNumber
      ? `codef-group-${fingerprint([organization, rowCardId, approvalNumber, row.resUsedDate]).slice(0, 40)}`
      : `codef-review-${fingerprint([organization, rowCardId, occurredAt, amount, row.resMemberStoreName]).slice(0, 40)}`;
    return [{
      providerEventId,
      groupKey,
      eventType: 'acquisition',
      occurredAt: acquiredAt,
      amount,
      currency: compact(row.resAccountCurrency || row.resCurrency) || 'KRW',
      approvalNumber,
      originalProviderEventId: null,
      merchantName: compact(row.resMemberStoreName) || null,
      merchantBusinessNumber: compact(row.resMemberStoreCorpNo) || null,
      requiresReview: !approvalNumber,
    }];
  });
}

const ymdKst = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replaceAll('-', '');

function storedCredential(connection) {
  if (!connection?.credential_reference_encrypted) throw codefError('credential_missing', 'Connected ID가 없습니다.', 401);
  return JSON.parse(decryptSecret(connection.credential_reference_encrypted));
}

export function codefCardProvider(connection = null) {
  return {
    provider: 'codef',
    async authenticate(authentication = {}) {
      if (!codefConfigured({ requirePublicKey: true })) throw codefError('not_configured', 'CODEF 키와 암호화 키가 필요합니다.', 503);
      const organization = compact(authentication.organization || authentication.cardCompanyCode);
      const loginType = compact(authentication.loginType ?? authentication.loginMethod);
      if (!/^03\d{2}$/.test(organization) || !['0', '1'].includes(loginType) || !authentication.password) {
        throw codefError('authentication_fields_required', '카드사, 로그인 방식, 비밀번호를 확인해 주세요.', 400);
      }
      const account = { countryCode: 'KR', businessType: 'CD', clientType: 'B', organization, loginType, password: rsaEncrypt(authentication.password) };
      if (loginType === '0') {
        if (!authentication.derFile || !authentication.keyFile) throw codefError('certificate_files_required', '공동인증서 파일이 필요합니다.', 400);
        account.derFile = authentication.derFile;
        account.keyFile = authentication.keyFile;
      } else {
        if (!authentication.id) throw codefError('id_required', '카드사 로그인 ID가 필요합니다.', 400);
        account.id = authentication.id;
      }
      const body = await callCodef('/v1/account/create', { accountList: [account] });
      const connectedId = compact(body?.data?.connectedId);
      if (!connectedId) throw codefError('connected_id_missing', 'Connected ID가 반환되지 않았습니다.');
      return { credentialReference: encryptSecret(JSON.stringify({ connectedId, organization, loginType })), expiresAt: null };
    },
    async listCards() {
      const credential = storedCredential(connection);
      return normalizeCodefCards(await callCodef('/v1/kr/card/b/account/card-list', {
        connectedId: credential.connectedId,
        organization: credential.organization,
      }), credential.organization);
    },
    async fetchEvents({ card, from, to }) {
      const credential = storedCredential(connection);
      const body = await callCodef('/v1/kr/card/b/account/approval-list', {
        connectedId: credential.connectedId,
        organization: credential.organization,
        startDate: ymdKst(from),
        endDate: ymdKst(to),
        orderBy: '0',
        inquiryType: '1',
        applicationType: '0',
        memberStoreInfoType: '3',
      });
      // Declined authorizations are useful operational metadata but are not
      // ledger events. Keep the mapper explicit while excluding them from the
      // current immutable expense-event RPC contract.
      const events = normalizeCodefEvents(body, credential.organization, card?.provider_card_id || null).filter(event => event.eventType !== 'declined');
      events.nextCursor = null;
      return events;
    },
    async fetchAcquisitions({ card, from, to }) {
      if (process.env.CODEF_PURCHASE_ENABLED === 'false') return [];
      const credential = storedCredential(connection);
      const body = await callCodef('/v1/kr/card/b/account/purchase-detail', {
        connectedId: credential.connectedId,
        organization: credential.organization,
        startDate: ymdKst(from),
        endDate: ymdKst(to),
        orderBy: '0',
        inquiryType: '1',
      });
      return normalizeCodefPurchases(body, credential.organization, card?.provider_card_id || null);
    },
  };
}

export function resetCodefTokenCache() {
  tokenCache.clear();
}

export function normalizeCodefBankAccounts(body, organization = '') {
  return arrayData(body).flatMap((row, sourceIndex) => {
    const account = compact(row.resAccount || row.resAccountNo);
    const accountDigits = digits(account);
    if (!account || accountDigits.length < 4) return [];
    return [{
      providerAccountId: `codef-bank-${fingerprint([organization, account]).slice(0, 32)}`,
      accountReference: encryptSecret(account),
      bankName: compact(row.resBankName || row.resOrganizationName) || '은행',
      displayName: compact(row.resAccountName || row.resAccountDisplay) || '법인계좌',
      last4: accountDigits.slice(-4),
      balance: integerAmount(row.resAccountBalance ?? row.resBalance),
      currency: compact(row.resAccountCurrency || row.resCurrency) || 'KRW',
      sourceIndex,
    }];
  });
}

export function codefBankProvider(connection = null) {
  return {
    provider: 'codef',
    async authenticate(authentication = {}) {
      if (!codefConfigured({ requirePublicKey: true })) throw codefError('not_configured', 'CODEF 키와 암호화 키가 필요합니다.', 503);
      const organization = compact(authentication.organization);
      const loginType = compact(authentication.loginType ?? authentication.loginMethod);
      if (!/^\d{4}$/.test(organization) || !['0', '1'].includes(loginType) || !authentication.password) throw codefError('authentication_fields_required', '은행, 로그인 방식, 비밀번호를 확인해 주세요.', 400);
      const account = { countryCode: 'KR', businessType: 'BK', clientType: 'B', organization, loginType, password: rsaEncrypt(authentication.password) };
      if (loginType === '0') {
        if (!authentication.derFile || !authentication.keyFile) throw codefError('certificate_files_required', '공동인증서 파일이 필요합니다.', 400);
        account.derFile = authentication.derFile; account.keyFile = authentication.keyFile;
      } else {
        if (!authentication.id) throw codefError('id_required', '기업 인터넷뱅킹 ID가 필요합니다.', 400);
        account.id = authentication.id;
      }
      const body = await callCodef('/v1/account/create', { accountList: [account] });
      const connectedId = compact(body?.data?.connectedId);
      if (!connectedId) throw codefError('connected_id_missing', 'Connected ID가 반환되지 않았습니다.');
      return { credentialReference: encryptSecret(JSON.stringify({ connectedId, organization, loginType })) };
    },
    async listAccounts() {
      const credential = storedCredential(connection);
      const body = await callCodef('/v1/kr/bank/b/account/account-list', { connectedId: credential.connectedId, organization: credential.organization });
      return normalizeCodefBankAccounts(body, credential.organization);
    },
    async fetchTransactions({ account, from, to }) {
      const credential = storedCredential(connection);
      if (!account?.account_reference_encrypted) throw codefError('account_reference_missing', '조회할 계좌 참조가 없습니다.', 400);
      const accountNumber = decryptSecret(account.account_reference_encrypted);
      const body = await callCodef('/v1/kr/bank/b/account/transaction-list', { connectedId: credential.connectedId, organization: credential.organization, account: accountNumber, startDate: ymdKst(from), endDate: ymdKst(to), orderBy: '0', inquiryType: '0' });
      return normalizeCodefBankTransactions(body, account.provider_account_id);
    },
    async disconnect() {
      const credential = storedCredential(connection);
      await callCodef('/v1/account/delete', { connectedId: credential.connectedId, accountList: [{ countryCode: 'KR', businessType: 'BK', clientType: 'B', organization: credential.organization, loginType: credential.loginType }] });
    },
  };
}

export function normalizeCodefBankTransactions(body, providerAccountId = '') {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.resTrHistoryList) ? body.data.resTrHistoryList : [];
  return rows.flatMap(row => {
    const occurredAt = dateTimeKst(row.resAccountTrDate || row.resTranDate, row.resAccountTrTime || row.resTranTime);
    const withdrawal = integerAmount(row.resAccountOut);
    const deposit = integerAmount(row.resAccountIn);
    const direction = withdrawal > 0 ? 'withdrawal' : deposit > 0 ? 'deposit' : null;
    const amount = direction === 'withdrawal' ? withdrawal : deposit;
    if (!occurredAt || !direction || !amount) return [];
    const descriptions = [row.resAccountDesc1, row.resAccountDesc2, row.resAccountDesc3, row.resAccountDesc4].map(compact).filter(Boolean);
    const providerTransactionId = compact(row.resTransactionId || row.transactionId) || `codef-bank-tx-${fingerprint([providerAccountId, occurredAt, direction, amount, row.resAfterTranBalance, ...descriptions])}`;
    return [{ providerTransactionId, occurredAt, direction, amount, balanceAfter: integerAmount(row.resAfterTranBalance), description: descriptions.join(' · ') || null }];
  });
}
