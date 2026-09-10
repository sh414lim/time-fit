# Toss Place 매출 연동 — 환경 설정 체크리스트

## 현재 준비 상태

- TimeFit Supabase 마이그레이션 3개가 저장소에 준비되어 있습니다.
- TimeFit Vercel Production에는 `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`만 등록되어 있습니다.
- Toss Place API·웹훅·Cron 서버 코드는 아직 이 저장소에 없습니다. 따라서
  환경변수만 등록해도 매출 동기화가 실행되지는 않습니다.

## Vercel Production에 등록할 서버 전용 변수

아래 변수는 Vercel Dashboard 또는 CLI에서 **Production** 환경에만 등록합니다.
`VITE_` 접두사를 사용하면 브라우저 번들에 포함되므로 절대 사용하지 않습니다.

| 변수 | 값의 출처 |
| --- | --- |
| `SUPABASE_URL` | TimeFit Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | TimeFit Supabase → Project Settings → API → Service role key |
| `TOSSPLACE_MERCHANT_ID` | 기존 `villa_order` Vercel Production 또는 Toss Place 매장 설정 |
| `TOSSPLACE_ACCESS_KEY` | Toss Place 개발자센터 → 버터빌라 매출 연동 → 인증 정보 |
| `TOSSPLACE_ACCESS_SECRET` | Toss Place 개발자센터 → 인증 정보. 분실 시 재발급 |
| `CRON_SECRET` | 32자 이상 새 랜덤값 |
| `DASHBOARD_USERNAME` | 매출 대시보드 운영 계정 |
| `DASHBOARD_PASSWORD` | 새 강한 비밀번호 |

## 등록 전 확인

1. 기존 `villa_order`의 Cron은 유지합니다.
2. Toss Place API 엔드포인트와 매출 화면을 TimeFit에 이식합니다.
3. `supabase db push`로 Toss 매출 마이그레이션 적용 여부를 확인합니다.
4. `/api/sync-sales` 수동 동기화와 매출 조회를 검증합니다.
5. 검증 뒤 TimeFit Cron을 켜고 기존 `villa_order` Cron을 해제합니다.

## 제공이 필요한 정보

키 값 자체를 채팅이나 Git에 남기지 말고, Vercel Dashboard에 직접 입력합니다.
구현·검증을 위해서는 다음 정보만 안전한 채널로 확인되면 됩니다.

- Toss Place Merchant ID
- Toss Place Access Key / Access Secret이 Vercel에 등록되었는지 여부
- TimeFit Supabase Service Role Key가 Vercel에 등록되었는지 여부
- 매출 대시보드 접근 정책: TimeFit 관리자 로그인 연동 또는 별도 계정 방식
