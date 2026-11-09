import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { axBaseUrl } from '../server/api/_timefit-ax.js';

// GET only: never submits a receipt or invokes the analyzer.
export async function checkTimefitAx({ env = process.env, fetchImpl = fetch } = {}) {
  let base;
  try {
    base = axBaseUrl({ value: env.TIMEFIT_AX_URL || '', allowedHosts: env.TIMEFIT_AX_ALLOWED_HOSTS || '', nodeEnv: 'production' });
  } catch {
    return { ok: false, code: 'CONFIG_URL', message: '운영 HTTPS 주소와 정확한 허용 호스트를 확인하세요.' };
  }
  const key = env.TIMEFIT_AX_TRANSPORT_KEY;
  if (!key || key.trim().length < 32 || key !== key.trim()) {
    return { ok: false, code: 'CONFIG_KEY', message: '앞뒤 공백 없는 32자 이상의 AX 공유키가 필요합니다.' };
  }
  const url = `${base}/api/timefit/v1/receipt-sessions/healthcheck-${randomUUID()}`;
  const request = async headers => {
    const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
    await response.body?.cancel();
    return response.status;
  };
  try {
    const unauthenticated = await request({});
    if (unauthenticated !== 401) return { ok: false, code: 'AUTH_GUARD', status: unauthenticated, message: 'AX 경로 또는 인증 차단을 확인하세요. 무인증 요청은 401이어야 합니다.' };
    const authenticated = await request({ 'X-Timefit-Ax-Key': key });
    if (authenticated !== 404) return { ok: false, code: 'AUTHENTICATED_LOOKUP', status: authenticated, message: '공유키 일치 여부와 AX 서버 상태를 확인하세요. 신규 점검 ID 조회는 404이어야 합니다.' };
    return { ok: true, code: 'TRANSPORT_OK', message: 'HTTPS 연결과 공유키 인증 확인. 새 영수증 분석·운영 웹 연결은 별도 검증이 필요합니다.' };
  } catch {
    // Do not print exceptions: URLs, proxy responses or credentials may be included.
    return { ok: false, code: 'NETWORK', message: 'AX 연결 실패: 터널·서버 실행 상태와 주소 변경 여부를 확인하세요. 리다이렉트는 허용하지 않습니다.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkTimefitAx();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
