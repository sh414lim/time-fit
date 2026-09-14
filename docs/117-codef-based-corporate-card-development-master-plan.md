# TimeFit CODEF 기반 법인카드 개발 마스터 기획·설계

버전: 1.0

작성일: 2026-09-12

상태: 구현 기준안

대상: 레오핏테크 멀티테넌트 SaaS TimeFit

## 1. 최종 결정

TimeFit의 1차 법인카드 데이터 Provider는 CODEF로 가정하고 개발한다.

- TimeFit은 카드사 홈페이지를 직접 스크래핑하지 않는다.
- CODEF가 카드사 인증, 보유카드 조회, 승인·취소·부분취소·매입정보 수집을 담당한다.
- TimeFit은 연결 UX, 동의, 권한, 동기화 오케스트레이션, 표준화, 영수증 매칭, 지출 원장, 결산을 담당한다.
- 내부 도메인은 CODEF 필드에 종속시키지 않고 Provider Adapter 뒤에 둔다.
- 계약이 불발되거나 일부 카드사가 미지원일 때 CSV와 다른 Provider를 연결할 수 있어야 한다.

CODEF 홈페이지와 개발문서로 기술 가능성은 확인했지만, 운영 도입은 다음 서면 확인 후 확정한다.

1. TimeFit 고객사에 제공하는 멀티테넌트 SaaS 용도가 허용되는가
2. 법인카드 API별 운영 단가, 최소 사용료, 초과요금은 얼마인가
3. 인증수단 등록·Connected ID 발급·인증서 relay의 계약 범위는 무엇인가
4. 운영 호출량·동시성·카드사별 최소 호출 간격은 얼마인가
5. 장애 SLA, 기술지원, 카드사 사이트 변경 대응 책임은 무엇인가

## 2. 제품 목표

> 고객사 관리자가 법인카드를 한 번 연결하면 카드 사용내역이 자동 수집되고, 직원은 영수증만 촬영하며, 관리자는 예외만 처리해 일·주·월·연 결산과 순익을 확인한다.

핵심 KPI:

| 지표 | 출시 목표 |
|---|---:|
| 지원 대상 카드 연결 성공률 | 95% 이상 |
| 정상 연결의 정기 동기화 성공률 | 99% 이상 |
| 중복 지출 생성률 | 0.1% 미만 |
| 카드 거래-영수증 자동 추천률 | 80% 이상 |
| 자동 고신뢰 매칭 정확도 | 98% 이상 |
| 관리자 수동 처리율 | 20% 이하 |
| 데이터 최신성 | 기본 8시간 이내 |

`실시간 조회`라는 표현은 사용하지 않는다. 초기 상품 문구는 `하루 3회 자동 동기화`와 `마지막 동기화 시각`으로 통일한다.

## 3. CODEF에서 확인된 구현 범위

### 3.1 지원 범위

- KB, 현대, 삼성, NH, BC, 신한, 씨티, 우리, 롯데, 하나, 전북, 광주, 수협, 제주 등 14개 카드사
- 법인 보유카드 조회
- 법인 승인내역 조회
- 공동인증서 또는 카드사 홈페이지 ID 기반 연결
- Connected ID를 이용한 반복 조회
- 정상, 전체취소, 부분취소, 거절 구분
- 취소금액, 매입 여부, 매입일
- 승인번호, 가맹점, 사업자번호, 부가세 등

### 3.2 공식 Endpoint 기준

```text
보유카드 Demo       POST https://development.codef.io/v1/kr/card/b/account/card-list
보유카드 Production POST https://api.codef.io/v1/kr/card/b/account/card-list
승인내역 Demo       POST https://development.codef.io/v1/kr/card/b/account/approval-list
승인내역 Production POST https://api.codef.io/v1/kr/card/b/account/approval-list
```

공식 timeout이 보유카드 240초, 승인내역 300초이므로 브라우저 요청이나 짧은 서버리스 요청 한 번에 전체 동기화를 끝내지 않는다. API는 작업을 접수하고 Worker가 비동기로 실행한다.

### 3.3 가격·환경

| 환경 | 용도 | 공개 조건 |
|---|---|---|
| Sandbox | 형식·오류·매핑 개발 | 무료, 테스트 데이터 |
| Demo | 실제 기관 연결 검증 | 1개월 무료, 일 100회 |
| Production | 상용 수집 | 호출량 과금, 견적 상담 |

운영 단가는 공개되어 있지 않으므로 가격을 코드나 사업계획에 확정값으로 넣지 않는다.

## 4. 출시 범위

### P0: 상용 MVP

- 금융정보 수집 동의 및 동의 이력
- 사업자/법인 유형, 카드사, 인증방식 선택
- CODEF 인증수단 등록과 Connected ID 연결
- 보유카드 조회, 사용할 카드 선택
- 카드 별칭, 매장, 부서, 담당자 지정
- 최근 89일 백필
- 승인·취소·부분취소·거절·매입상태 수집
- 하루 3회 자동 동기화와 수동 새로고침
- 연결 상태, 마지막 성공시각, 재인증 안내, 연결 해제
- 영수증 촬영·업로드, OCR/LLM 구조화 결과와 거래 매칭
- 미증빙·중복의심·취소미연결·수집실패 예외함
- 카드 지출과 매출·인건비를 결합한 일·주·월·연 보고 및 순익
- CSV 가져오기 폴백

### P1: 안정화

- 카드사별 수집 능력표와 동적 연결 폼
- 월초 전월 전체 재대사
- 재발급 카드 연결
- 관리자 알림과 증빙 요청 자동화
- 마감 잠금, 재오픈 승인, 보고서 PDF/Excel
- 비용·성공률·지연·오류 운영 대시보드

### 제외

- 카드 결제·송금·한도 변경
- 카드사별 자체 스크래핑
- 전체 카드번호, CVC, 카드 비밀번호의 TimeFit 저장
- 세무 신고 대행 또는 전자신고
- CODEF API 재판매

## 5. 목표 아키텍처

```text
[TimeFit Web]
  └─ 동의·연결·카드선택·상태조회
          │
          ▼
[Card Connection API]
  ├─ 서버 권한/조직 검증
  ├─ 동의 검증
  └─ CODEF Adapter
          │
          ▼
[CODEF 인증수단 등록 / Connected ID]
          │
          ▼
[Sync Job Queue] ── [Worker + 기관별 Rate Limit]
          │                    │
          │                    ▼
          │             [CODEF Card APIs]
          ▼
[원문 해시/요약] → [불변 카드 이벤트] → [거래 그룹]
                                             │
[영수증] → Storage → Vision → LLM → 검증·매칭
                                             │
                                             ▼
                                         [지출 원장]
                                             │
                       매출 + 실제 인건비 ──┤
                                             ▼
                              [결산 Snapshot / 순익]
```

경계 원칙:

- CODEF 응답은 Adapter에서 TimeFit 표준 모델로 변환한다.
- Provider 장애가 기존 지출·매출·근태·보고서 조회를 막지 않는다.
- 원천 이벤트는 수정하지 않고 새 이벤트와 그룹 projection으로 정정한다.
- 확정된 결산은 당시 데이터 snapshot으로 고정한다.
- 모든 금융 객체, 작업, 로그에 `organization_id`를 둔다.

## 6. 연결 사용자 흐름

### 6.1 정상 흐름

1. 소유자 또는 비용관리자가 `재무 > 법인카드 > 카드 연결`을 누른다.
2. 수집 항목, 목적, Provider, 보존기간, 철회 방법을 확인하고 동의한다.
3. 법인 유형과 카드사를 선택한다.
4. CODEF capability에 맞춰 공동인증서 또는 ID 로그인을 선택한다.
5. 민감 인증값은 TLS 요청 메모리에서만 취급하고 CODEF에 등록한다.
6. CODEF에서 받은 Connected ID reference를 서버 전용 저장소에 보관한다.
7. 보유카드 목록을 조회해 마스킹된 카드만 표시한다.
8. 사용할 카드와 매장·부서·담당자를 지정한다.
9. 연결을 저장하고 백필 작업을 Queue에 등록한다.
10. 화면은 즉시 닫히고 `내역 불러오는 중` 상태를 보여준다.
11. 완료 후 최근 내역, 최신시각, 예외 수를 표시한다.

### 6.2 버튼·용어

혼동을 줄이기 위해 다음 용어를 사용한다.

| 상황 | 버튼 | 의미 |
|---|---|---|
| 인증 단계 | `카드사 인증 계속` | 인증정보를 Provider에 등록 |
| 카드 선택 단계 | `선택한 카드 연결` | TimeFit 연결을 생성하고 동기화 시작 |
| 연결 설정 수정 | `변경사항 저장` | 별칭·매장·담당자만 수정 |
| 즉시 조회 | `지금 동기화` | 새 동기화 작업 접수 |
| 연결 중단 | `카드 연결 해제` | 이후 자동수집 중지·credential 폐기 |
| 마법사 이탈 | `나중에 하기` | 아직 연결하지 않고 닫기 |

`등록`, `저장`, `취소`를 같은 화면에 혼용하지 않는다. 이미 생성된 카드 거래를 지우는 의미의 `취소`도 사용하지 않고 `연결 해제`, `변경 취소`로 구분한다.

### 6.3 상태 모델

```text
draft
→ awaiting_auth
→ discovering_cards
→ selecting_cards
→ initial_sync
→ active
→ degraded
→ reauth_required
→ disconnected
```

- 로그인 실패·추가인증 필요 시 자동 재시도를 멈춘다.
- `reauth_required`는 기존 거래를 유지하면서 이후 수집만 중단한다.
- 연결 해제 시 CODEF revoke/삭제 가능 여부에 따라 credential을 폐기하고 기록한다.

## 7. 데이터 모델

### 7.1 핵심 테이블

```text
card_provider_configs        운영 Provider/환경/기능 플래그
card_consents                동의 전문 version/hash/시각/철회
card_connections             조직-카드사-Connected ID 연결 상태
card_connection_secrets      서버 전용 credential reference
connection_assets            CODEF 보유카드 원본 식별 projection
corporate_cards              TimeFit 카드 별칭/담당/매장
card_sync_jobs               비동기 작업, lease, retry, 비용 추정
card_sync_runs               실행 결과와 수집 구간
card_sync_cursors            연결·카드·데이터종류별 watermark
card_transaction_events      승인/취소/거절/매입 불변 이벤트
card_transaction_groups      원승인 기준 순액 projection
expense_sources              카드·영수증·수기 source
expense_matches              추천·확정·해제 이력
expenses                     단일 지출 원장
closeouts                    일·주·월·연 결산 snapshot
audit_events                 연결·열람·재인증·해제 감사기록
```

### 7.2 필수 제약

- 활성 연결 unique: `(organization_id, provider, organization_code, provider_account_namespace)`
- 카드 unique: `(organization_id, provider, provider_asset_id)`
- 이벤트 unique: `(organization_id, provider, provider_event_id)`
- 영수증 파일 unique 후보: `(organization_id, sha256)`
- 하나의 카드 거래 그룹은 하나의 활성 expense에만 primary source로 연결
- 하나의 영수증은 하나의 활성 expense에만 primary source로 연결
- 조직 ID가 다른 parent-child 관계는 FK 또는 trigger로 거부
- 카드·연결 삭제가 거래·지출·결산을 cascade 삭제하지 않음

### 7.3 비밀정보 분리

`card_connection_secrets`는 브라우저와 일반 관리자 RLS에서 접근할 수 없는 서버 전용 영역으로 분리한다.

저장 허용:

- CODEF Connected ID 또는 Provider credential reference
- 서버 암호화된 최소 메타데이터
- key version, created_at, rotated_at, revoked_at

저장 금지:

- 공동인증서 파일·개인키 원문
- 카드사 비밀번호 원문
- 전체 PAN, CVC
- 인증 요청 body 또는 Provider 원문 응답 전체 로그

## 8. CODEF Adapter 명세

```ts
interface CorporateCardProvider {
  getCapabilities(input): Promise<ProviderCapabilities>
  registerCredential(input): Promise<CredentialReference>
  listCards(connection): Promise<ProviderCard[]>
  fetchApprovals(query): Promise<ProviderResult<CardEvent[]>>
  checkHealth(connection): Promise<ProviderHealth>
  revoke(connection): Promise<void>
  classifyError(error): ProviderError
}
```

CODEF 구현 파일 권장:

```text
server/api/providers/codef/
  client.js
  auth.js
  capabilities.js
  card-list.js
  approval-list.js
  mapper.js
  errors.js
```

Provider 선택은 클라이언트 값이 아니라 서버 환경설정으로 고정한다. Production에서 `mock`을 거부한다.

### 8.1 승인내역 매핑

| CODEF 필드/값 | TimeFit |
|---|---|
| `resCancelYN=0` | `approval` |
| `resCancelYN=1` | `cancellation` |
| `resCancelYN=2` | `partial_cancellation` |
| `resCancelYN=3` | `declined`, 지출 합계 제외 |
| `resCancelAmount` | `cancel_amount` |
| `resPurchaseYN=1` | `acquired` projection 후보 |
| `resPurchaseDate` | `acquired_at` |
| `resApprovalNo` | `approval_number` |
| `resMemberStoreName` | `merchant_name` |
| `resMemberStoreCorpNo` | `merchant_business_number` |
| `resVAT` | `vat_amount` 후보 |
| `resUsedDate` + `resUsedTime` | `occurred_at` |

금액과 날짜는 문자열 상태에서 검증한 뒤 integer minor unit와 timezone이 명시된 timestamp로 변환한다. 파싱 실패는 0으로 치환하지 않고 quarantine한다.

## 9. 카드 식별과 PAN 방지

CODEF `resCardNo`는 카드사별 마스킹 형식이 다를 수 있으므로 그대로 안정 ID로 믿지 않는다.

우선순위:

1. 계약 단계에서 CODEF의 비변경 카드 식별자 제공 여부 확인
2. 안정 ID가 있으면 Provider namespace와 함께 HMAC
3. 없으면 기관코드 + Connected ID namespace + 정규화 마스킹 번호 + 카드명 + 발급/재발급 정보로 fingerprint
4. 충돌 시 자동 병합하지 않고 관리자 확인
5. 재발급은 `previous_card_id`로 연결

DB write 전에 13~19자리 PAN 후보를 검사하고 차단한다. 화면에는 issuer, 별칭, 신뢰 가능한 last4만 표시한다.

카드별 승인 조회가 전체 카드번호를 요구한다면 TimeFit 저장 방식으로 우회하지 않는다. `inquiryType=전체`로 조회 가능한지 Demo에서 검증하고 불가능하면 CODEF가 보관한 credential/card reference를 사용하는 공식 방식을 계약으로 확인한다.

## 10. 동기화 설계

### 10.1 기본 정책

- 최초 백필: 최근 89일
- 정기 수집: 09:00, 16:00, 20:00 KST
- 증분 조회: 마지막 성공 watermark보다 7일 앞에서 overlap
- 월초: 전월 전체 재조회·대사
- 수동 동기화: 연결별 cooldown과 조직별 일일 한도 적용
- 인증 오류: 자동 retry 금지
- 일시 장애: 지수 backoff와 jitter, 최대 횟수 후 dead-letter
- 한 번 성공한 페이지/구간만 cursor 진전

### 10.2 카드사별 조회 창

| 카드사 | 공식 제약을 반영한 안전 작업 단위 |
|---|---|
| 신한 | 최대 1주 |
| BC | 최대 1개월 |
| 씨티 | 최대 3개월 |
| 수협 | 최대 6개월 |
| 광주 | 최대 1년 |
| 기타 | CODEF capability에 따라 7~31일 기본값 |

CODEF가 큰 범위를 내부 분할해도 TimeFit은 작은 작업으로 나눈다. 그래야 timeout, 재시도 비용, 부분 실패를 통제할 수 있다.

### 10.3 Queue 필수 필드

```text
id, organization_id, connection_id, organization_code
data_type, range_start, range_end, priority
status, attempt_count, next_attempt_at
lease_owner, lease_expires_at, heartbeat_at
estimated_calls, actual_calls
last_error_class, last_error_code
created_at, started_at, completed_at
```

Worker는 `FOR UPDATE SKIP LOCKED` 또는 동등한 원자적 lease로 작업을 가져간다. Vercel request 안에서 240~300초 응답을 기다리는 구조는 금지한다.

## 11. 취소·부분취소·중복 방지

승인, 취소, 매입을 각각 별도 지출로 합산하지 않는다.

```text
거래 그룹 순액 = 승인액 - 연결된 전체취소액 - 부분취소액 합계
거절 거래 = 원장 합계 제외
매입정보 = 승인 그룹의 확정 상태/금액 projection
```

그룹 키 우선순위:

1. Provider가 제공하는 원거래 stable ID
2. 기관 + 카드 fingerprint + 승인번호 + 원승인일시 + 통화
3. 승인번호 누락 시 카드 + 시각 + 금액 + 가맹점 fingerprint

3번은 자동 확정하지 않고 `needs_review`로 보낸다. 동일 응답 재수집은 provider event ID 또는 정규화 payload checksum으로 멱등 처리한다.

### 카드 내역과 영수증의 중복 방지

- 카드 거래와 영수증은 둘 다 `expense_source`이며 각각 지출이 아니다.
- 매칭되면 동일한 `expense_id`를 가리킨다.
- 카드 거래 금액을 회계 금액의 기준으로 하고 영수증은 증빙·품목·세액 보강에 사용한다.
- 영수증이 먼저 지출을 만든 뒤 카드 거래가 도착하면 새 지출을 만들지 않고 기존 지출에 병합한다.
- 영수증 sha256, 사업자번호, 금액, 일시, 승인번호로 중복 후보를 판정한다.
- 자동 확정은 고신뢰 기준을 모두 만족할 때만 수행한다.

## 12. 오류·계정 잠금 방지

오류 분류:

| 분류 | 처리 |
|---|---|
| invalid_credentials | 즉시 중단, 재인증 요청 |
| additional_auth_required | 사용자 액션 요청, retry 금지 |
| account_locked | 즉시 중단, 카드사 해제 안내 |
| rate_limited | Provider 지침에 따른 backoff |
| issuer_maintenance | 일정 시간 후 제한 재시도 |
| provider_timeout | 같은 idempotency key로 제한 재시도 |
| parsing_error | 원문 checksum 보관, quarantine |
| unsupported_capability | 해당 기능 비활성화, 대안 안내 |

카드사별 비밀번호 실패를 일반 네트워크 오류로 취급해 재시도하면 계정이 잠길 수 있다. Adapter의 `classifyError` 테스트를 출시 차단 조건으로 둔다.

## 13. TimeFit API

```text
POST   /api/card-connections/consents
GET    /api/card-connections/capabilities?organizationCode=0301
POST   /api/card-connections/auth-sessions
POST   /api/card-connections/:id/complete-auth
POST   /api/card-connections/:id/discover-cards
POST   /api/card-connections/:id/select-cards
GET    /api/card-connections
GET    /api/card-connections/:id
PATCH  /api/card-connections/:id
POST   /api/card-connections/:id/sync
POST   /api/card-connections/:id/reauth
DELETE /api/card-connections/:id
GET    /api/card-sync-jobs/:id
GET    /api/card-transactions
GET    /api/expense-exceptions
```

모든 mutation은 서버에서 조직 membership, role, consent version을 재검증한다. `organization_id`, `provider`, `consent_version`을 클라이언트가 신뢰 가능한 값으로 결정하지 못하게 한다.

## 14. 화면 설계

### 법인카드 목록

- 카드사 로고/명칭, 카드 별칭, last4
- 연결 상태: 정상/동기화 중/주의/재인증 필요/해제됨
- 마지막 성공 동기화 시각과 다음 예정시각
- 최근 30일 거래수, 미증빙수, 실패수
- `지금 동기화`, `설정`, `재인증`, `연결 해제`

### 거래함

- 날짜, 카드, 사용자, 가맹점, 승인금액, 순액, 취소/매입 상태
- 영수증 상태, 비용분류, 매장, 검토상태
- 취소·부분취소는 원승인 아래 타임라인으로 표시
- `원본 삭제`가 아니라 `지출 제외`, `중복 병합`, `매칭 해제`를 명시

### 예외함

관리자가 전건을 검토하지 않도록 다음만 모은다.

- 영수증 없음
- 복수 매칭 후보
- 취소 원승인 미발견
- 승인번호 누락/식별 충돌
- OCR/금액 불일치
- 마감 후 변경
- 인증 만료·동기화 실패

## 15. 보안·법률·운영 통제

- 개인정보/금융정보 처리 목적, 수집항목, Provider 제공, 보존기간을 동의 전문에 명시
- 전문 version과 hash, 동의·철회 시각, actor, IP/기기 최소 감사기록
- 최소권한 service role과 조직별 RLS
- credential reference 접근은 Worker와 인증 API만 허용
- 로그, APM, 오류추적에서 password, certificate, token, PAN 자동 마스킹
- 암호키 버전관리·회전·폐기
- 연결 해제와 고객 탈퇴 시 credential 폐기 절차
- 공급망 장애, 유출, 인증서 오남용 대응 runbook
- Provider 약관 변경과 위수탁/제3자 제공 문구를 법무 검토

운영자도 고객 금융 원문을 기본 조회하지 못한다. 고객 승인된 break-glass 접근만 허용하고 전 과정을 감사한다.

## 16. 현재 코드 기준 변경사항

### 유지 가능한 자산

- `card_connections`, `connection_assets`, `corporate_cards`
- 카드 이벤트 import RPC와 중복 방지 기반
- 카드 연결/재인증/동기화 API의 외형
- 지출 원장, 영수증 처리, 보고서 도메인
- mock Provider와 기존 테스트 fixture

### 반드시 수정할 부분

1. `server/api/providers/card-provider.js`
   - `codef` adapter 추가
   - Production provider를 서버에서 고정
   - Production의 mock 거부
2. `src/features/finance/CardConnectionWizard.jsx`
   - CODEF capability 기반 동적 인증 UI
   - `등록/저장/취소` 문구를 연결·변경·이탈 의미로 분리
3. credential 저장
   - 일반 연결 row의 encrypted JSON 제거
   - Connected ID reference를 서버 전용 테이블/Vault로 이동
4. 카드 식별
   - 카드번호 fallback 제거
   - Provider stable ID/HMAC fingerprint 적용
5. `_card-sync-runner.js`
   - 단일 동기 요청을 Queue/Worker로 분리
   - 기간 chunk, lease, heartbeat, retry, dead-letter 추가
6. `card-sync-worker.js`
   - 조직·기관별 동시성, 호출 예산, cooldown 추가
7. consent
   - 서버 관리 동의 전문/version/hash/철회 API 추가
8. RLS/FK
   - 관리자 전체 CRUD 축소
   - composite organization 무결성 보강

## 17. 개발 로드맵

### Gate 0 — 계약·기술 확인 (3~5영업일)

- CODEF 견적·SaaS 제공권·법인카드 API 범위 확인
- 인증서 relay/Connected ID 전체 시나리오 확인
- 카드사별 인증방식·조회기간·오류코드 원본 확보
- Demo 신청과 테스트 법인/카드 준비
- Go/No-Go 기록

산출물: 계약 체크리스트, capability matrix, 가격 모델, DPA/보안 검토.

### Sprint 1 — 보안 기반과 Adapter 골격 (1주)

- CODEF client, OAuth/token 처리, 환경 분리
- secret table/Vault와 redaction
- 서버 provider lock
- consent 모델/API
- 기관코드 capability 모델

완료 조건: 비밀값이 DB 일반 row, browser response, log에 남지 않는다.

### Sprint 2 — 연결·보유카드 (1주)

- 인증 session/complete 흐름
- Connected ID 저장
- 보유카드 조회·매핑
- 카드 선택·별칭·매장·담당자
- 재인증·연결 해제

완료 조건: Demo 실제 카드로 연결→목록→해제 E2E 성공.

### Sprint 3 — 수집 Queue와 거래 정규화 (1~2주)

- sync job/lease/worker
- 기관별 기간 chunk와 rate limit
- 승인·취소·부분취소·거절·매입 매핑
- 멱등 import, 거래 grouping, quarantine
- 최신시각·진행률·오류 UI

완료 조건: 반복·중단·재시도에도 중복과 cursor 손실이 없다.

### Sprint 4 — 영수증·지출 통합 (1주)

- 기존 Vision/LLM 결과와 카드 source 매칭
- 고신뢰 자동매칭, 후보 추천, 매칭 해제
- 미증빙 요청과 예외함
- 카드/영수증 중복 지출 방지 제약

완료 조건: 영수증 선행/카드 선행 양쪽 순서에서 지출 1건만 생성.

### Sprint 5 — 결산·보고 (1주)

- 지출 순액과 매입상태 반영
- 일·주·월·연 기간 규칙
- 매출·실제 인건비 결합
- 운영순익 차트, 비교, drill-down
- 마감 snapshot, 재오픈, PDF/Excel

완료 조건: 거래→증빙→원장→마감→보고서 금액 대사가 일치.

### Sprint 6 — 운영 검증·배포 (1주)

- 카드사별 Demo/Production smoke test
- 장애·잠금·timeout·부분응답 chaos test
- 비용/호출량 dashboard와 alert
- 개인정보·보안·복구 runbook
- 제한 조직 canary 후 단계 확대

## 18. 테스트 전략

### Contract tests

- CODEF Sandbox fixture와 schema drift
- 카드사별 필수 파라미터
- 날짜·금액·부가세 파싱
- 정상/취소/부분취소/거절/매입 매핑
- 오류코드 분류

### Domain tests

- 동일 이벤트 재수집 멱등성
- 부분취소 여러 번과 전액취소 전환
- 취소가 원승인보다 먼저 도착
- 승인번호 없는 거래 quarantine
- 재발급·마스킹 형식 변화·fingerprint 충돌
- 매입상태 변경과 마감 후 조정
- 영수증 선행·카드 선행 중복 방지

### Security tests

- 조직 간 IDOR/RLS 차단
- Production mock 차단
- consent 미동의·구버전 거부
- PAN/비밀번호/인증서/token 로그 미노출
- 운영자와 일반 관리자의 secret 접근 차단
- 해제 후 credential 사용 불가

### E2E

```text
동의 → 카드사 인증 → 카드 선택 → 백필 → 거래 확인
→ 영수증 촬영/업로드 → 자동매칭 → 예외 처리
→ 월 마감 → 순익/보고서 → 재오픈 감사기록
```

## 19. 환경설정

```text
CARD_PROVIDER=codef
CODEF_ENV=sandbox|demo|production
CODEF_CLIENT_ID=server-secret
CODEF_CLIENT_SECRET=server-secret
CODEF_PUBLIC_KEY=server-secret-or-config
CODEF_API_BASE_URL=environment-derived
CARD_SYNC_QUEUE_ENABLED=true
CARD_SYNC_DEFAULT_LOOKBACK_DAYS=89
CARD_SYNC_OVERLAP_DAYS=7
CARD_SYNC_MANUAL_COOLDOWN_MINUTES=30
CARD_SYNC_MAX_ATTEMPTS=4
CARD_SECRET_KEY_VERSION=v1
```

Base URL을 클라이언트 입력으로 받지 않는다. 허용 환경별 고정값만 사용한다.

## 20. 비용·호출량 설계

월 예상 호출량은 다음으로 견적한다.

```text
월 호출량
= 활성 연결 수 × 정기 동기화 횟수 × 기간 chunk 수
+ 신규 연결의 보유카드/백필 호출
+ 월초 재대사
+ 수동 동기화
+ 실패 재시도
```

비용 통제:

- 조직 플랜별 연결 수와 수동 동기화 한도
- 동일 연결의 중복 job 병합
- 빈 기간과 이미 완료된 구간 재호출 방지
- 실패 유형별 재시도 차단
- 일/월 Provider 호출 예산 경보
- 비용 급증 시 수동 sync 우선 중단, 정기 수집 유지

가격 확정 전에는 고객 판매가를 고정하지 않는다. `기본 연결료 + 카드/연결 수 + 초과 동기화` 조합을 후보로 두고 실제 견적과 마진으로 결정한다.

## 21. 배포 승인 조건

아래가 하나라도 미충족이면 전체 Production 배포를 하지 않는다.

- CODEF 계약이 TimeFit 멀티테넌트 고객 제공을 허용
- 실제 운영 단가와 호출 제한 확인
- 주요 카드사 5곳 이상의 연결·조회 E2E 통과
- 취소·부분취소·거절·매입 대사 통과
- 비밀정보/PAN 저장·로그 노출 0건
- 반복 수집 중복 0건
- Worker 중단 후 안전 재개
- 인증 오류 자동재시도로 계정 잠금 유발하지 않음
- 연결 해제와 동의 철회 검증
- 카드 거래와 영수증의 이중 지출 방지 검증
- 월 결산과 보고서 대사 허용오차 0원 또는 명시된 반올림 범위
- 운영 runbook, 알림, rollback 준비

## 22. 즉시 실행 순서

1. CODEF에 운영 견적·SaaS 용도·인증서 relay·stable card ID·호출제약 질문 발송
2. Demo 계정과 테스트 법인카드 확보
3. 현재 코드의 credential/cardNo/provider 선택 P0 위험 제거
4. CODEF Adapter와 contract fixture 작성
5. 비동기 Queue/Worker를 먼저 완성
6. 연결·보유카드 E2E 후 승인내역 수집 구현
7. 취소·부분취소·매입 대사를 통과한 뒤 지출 원장에 연결
8. 영수증 매칭, 결산, 보고서 순으로 통합
9. 제한 조직 canary 배포 후 카드사별 확장

## 23. 미확정 질문

CODEF 계약/기술 미팅에서 반드시 답을 받아야 한다.

- 법인카드 상품별 API 명칭과 과금 단위
- Connected ID 생성·삭제·갱신·만료 규칙
- 인증서 relay 구현 방식과 TimeFit 서버 통과 여부
- 안정적인 카드/거래 ID 제공 여부
- 전체 카드 조회 시 카드번호 입력 없이 승인내역을 구분할 수 있는가
- 부분취소 원승인 연결키와 카드사별 정확도
- 승인 응답의 매입정보가 월 결산 확정에 충분한가
- pagination/최대 레코드/부분성공 응답 규칙
- 카드사별 호출 간격과 IP 차단 임계치
- Production timeout과 비동기/대량조회 대안
- 데이터 보관·재가공·최종 고객 표시 허용 범위
- 장애 SLA, 보상, 기술지원 채널, 변경 사전공지 기간

## 24. 최종 Definition of Done

TimeFit의 법인카드 기능은 단순히 `카드를 등록했다`가 아니라 다음 상태일 때 완성이다.

> 실제 고객 법인카드를 안전하게 연결하고, 내역을 중복 없이 계속 수집하며, 취소·부분취소·매입을 정확히 반영하고, 촬영 영수증과 하나의 지출로 결합하며, 관리자가 예외만 처리해 일·주·월·연 결산과 순익 보고서를 재현 가능한 금액으로 확정할 수 있다.

## 25. 로그인 계정 API 상품 조회 결과

확인일: 2026-09-12

확인 경로: `CODEF API > API 상품 > 기업 자금정보 패키지(PKG0007)` 및 `MY > 키 관리`

### 25.1 현재 계정 상태

| 환경 | 상태 | 조건 |
|---|---|---|
| 샌드박스 | 사용 중 | 개발 기간 무료 |
| 데모버전 | 미신청 | 1개월, 일 최대 100회 |
| 정식버전 | 미신청 | 화면상 무제한 표기, 실제 과금·공정사용 정책은 계약 확인 필요 |

키 관리 화면에 실제 `public_key`, `client_id`, `client_secret`이 노출되므로 그 값은 문서·브라우저 로그·이슈·메신저에 복사하지 않는다. 운영 전 현재 키가 외부에 노출된 적이 없는지 확인하고 필요하면 재발급한다.

### 25.2 카드 관련 선택 가능 API

| API 상품 | 화면에서 확인한 주요 데이터 | TimeFit 판정 |
|---|---|---|
| 보유카드 | 성명, 카드번호, 휴면 여부, 카드명·구분, 발급·유효·재발급일, 부서명 | P0 필수 |
| 승인내역 | 사용일시, 카드번호, 가맹점, 이용금액, 수수료·부가세·봉사료 등 | P0 필수 |
| 매입내역 | 사용일시, 카드번호, 가맹점, 이용금액, 결제방법, 수수료 등 | P0 필수 |
| 청구내역 | 결제예정일, 합계, 결제계좌, 일시불·할부·미결제·연체료 등 | P1 권장 |
| 한도조회 | 이용금액, 한도금액, 잔여한도 | 현재 제외 |
| 당일 승인내역 | 당일 사용일시·가맹점·금액·승인번호·취소여부 | 선택, 최신성 상품 검토 후 |
| 선결제내역 | 선결제일과 상세내역 | 현재 제외 |

### 25.3 신청 화면 확인 결과

정식버전 문의 화면은 API를 개별 선택하여 문의하는 구조다. TimeFit 후보로 다음 4개가 정상 선택되는 것을 확인했다.

```text
카드 > 법인 > 보유카드
카드 > 법인 > 승인내역
카드 > 법인 > 청구내역
카드 > 법인 > 매입내역
```

정식버전은 가격을 즉시 표시하지 않고 회사·연락처·문의내용을 제출하는 견적 문의 방식이다. 문의는 제출하지 않았다.

데모 신청 화면에서 다음 조건을 확인했다.

- 1개월 동안 사용
- 일 최대 100회
- 구축 서비스명과 회사정보 입력
- 사업자등록증 파일 첨부 필요
- 신청 완료 전 단계이며 실제 신청은 제출하지 않음

### 25.4 상품 구성 최종안

첫 Demo에는 4개 API를 신청한다.

1. 보유카드
2. 승인내역
3. 매입내역
4. 청구내역

운영 계약 시에는 `보유카드 + 승인내역 + 매입내역`을 필수 견적으로 받고, 청구내역을 추가했을 때의 단가 차이를 별도 비교한다. 청구내역은 월 결산 대사에 유용하지만 승인·매입만으로 MVP가 성립하면 비용에 따라 P1로 늦출 수 있다.

당일 승인내역은 일반 승인내역의 당일 조회 가능 시점과 갱신주기를 Demo에서 측정한 뒤 결정한다. 중복 데이터 상품을 동시에 사용하면 호출비용과 멱등 처리 복잡도가 늘어나므로 단순히 최신성이 좋아 보인다는 이유로 추가하지 않는다.
