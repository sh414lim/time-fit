# TimeFit 지출·증빙·법인카드 개발 로드맵 및 구현 명세

버전: 1.0  
작성일: 2026-09-10  
기준 문서: `docs/66-expense-closeout-final-master-plan.md`  
정합성 검토: `docs/68-master-plan-roadmap-alignment-review.md`  
목표: 법인카드 자동 연결·내역 자동조회·영수증 OCR·매출 연동·자동결산을 운영 가능한 품질로 출시

## 1. 개발 목표

### 핵심 사용자 약속

> 사업자가 카드사 또는 하이픈을 연결하면 보유 법인카드가 자동 등록되고, 승인·취소·매입 내역이 자동 조회된다. 직원이 영수증을 촬영하면 카드 거래와 자동 대조되고, 관리자는 예외만 처리해 일간·주간·월간·연말 결산을 완료한다.

### 완료 상태

- 카드사 연결 후 보유카드가 자동으로 나타난다.
- 최초 90일 내역과 이후 변경분을 자동으로 수집한다.
- 승인, 전체취소, 부분취소, 매입, 청구가 하나의 거래로 정리된다.
- 직원이 휴대폰 카메라로 영수증을 촬영·제출할 수 있다.
- OCR과 LLM이 필드를 추출하되 결정적 검증은 서버 규칙이 수행한다.
- 영수증과 카드 내역은 중복 지출을 만들지 않는다.
- 매출·인건비·지출이 같은 결산 원장에 반영된다.
- API 장애나 재인증 중에도 CSV로 업무를 계속할 수 있다.

## 2. 현재 환경과 판단

### 사용 중인 기술

| 영역 | 현재 기술 | 활용 방안 |
|---|---|---|
| 관리자 웹 | React 18, Vite 5 | 지출·카드·결산 화면 확장 |
| 직원 웹/태블릿 | React 웹, Flutter 태블릿 | 영수증 제출은 우선 반응형 웹/PWA, 태블릿은 조회 보조 |
| 인증·DB | Supabase Auth, PostgreSQL, RLS | 조직 격리, 원장, 연결 상태, 감사 기록 |
| 파일 | Supabase Storage | 비공개 영수증 원본·썸네일 저장 |
| 서버 API | Vercel Functions | 하이픈, Google Vision, LLM, 이메일 처리 |
| 배치 | Vercel Cron | 카드 동기화, 재대조, 결산 생성 |
| 배포 | Vercel | Preview와 Production 분리 |
| 매출 | Toss Place 연동 | 일간·기간 매출 원천으로 재사용 |
| 비밀정보 | AES-256-GCM 유틸리티 | 공급자 인증 참조와 제한적 비밀 암호화 |

### 현재 구현 상태

| 기능 | 상태 | 다음 작업 |
|---|---|---|
| 카드 수동 등록 | 구현됨 | 명칭 변경, 자동 연결과 분리 |
| CSV 카드내역 가져오기 | 기초 구현 | 매핑·미리보기·부분취소·오류 리포트 |
| 카드 자동 연결 | 미구현 | 하이픈 계약/테스트베드 및 서버 어댑터 |
| 자동 동기화 | 미구현 | 커서·작업잠금·재시도·Cron |
| 재인증·장애 UX | 미구현 | 연결 상태 머신과 복구 동선 |
| 금융 증빙 업로드 | 구현됨 | 카메라 중심 제출 흐름으로 분리 |
| OCR·LLM | 미구현 | Vision/LLM 서버 파이프라인 |
| 카드·영수증 매칭 | 미구현 | 후보 점수·확정·해제 |
| 지출 원장 | 미구현 | 원천과 확정 원장 분리 |
| 자동결산 | 일부 매출/급여 기반 | 지출 결합·스냅샷·마감 |

현재 카드 테이블은 `approval/cancellation`과 단순 거래 목록에 적합하지만 실제 연동의 승인→매입→청구 전이를 표현하기 어렵다. 기존 테이블을 바로 파괴하지 않고 새 이벤트/그룹 테이블로 확장한 후 데이터를 이관한다.

## 3. 목표 시스템 구조

```text
[직원 모바일]
  영수증 촬영·사유 제출
          │
          ▼
[TimeFit Web/API] ── [비공개 Storage]
          │
          ├── Google Vision OCR
          ├── LLM JSON 구조화
          └── 결정적 검증·매칭
                    │
[하이픈/카드사] → Provider Adapter → 카드 이벤트 → 거래 그룹
[이메일/CSV]    → Provider Adapter ───────────┘
                    │
                    ▼
              [단일 지출 원장]
                    │
[Toss Place 매출] ──┼── [실제 인건비]
                    ▼
          [일간/주간/월간/연말 결산]
```

### 설계 원칙

1. 브라우저는 외부 API 비밀값을 갖지 않는다.
2. 외부 응답은 정규화 계층을 통과한다.
3. 원천 이벤트는 수정하지 않고 정정 이벤트를 추가한다.
4. 결산은 확정 지출 원장만 한 번 합산한다.
5. 공급자를 바꾸어도 화면과 원장은 바뀌지 않는다.
6. 자동화 실패는 숨기지 않고 예외 업무로 전환한다.

## 4. 환경 구성

### 환경 분리

| 환경 | 목적 | 데이터 | 외부 연동 |
|---|---|---|---|
| Local | 개발·단위 테스트 | 로컬 Supabase/fixture | mock provider |
| Preview | PR 통합·QA | 별도 QA 조직 | 하이픈 테스트베드, Vision/LLM 제한 키 |
| Production | 실제 운영 | 운영 조직 | 하이픈 운영 상품 |

Preview가 Production DB와 Storage를 사용하지 않도록 프로젝트 또는 스키마/조직을 분리한다. 금융 테스트 데이터는 실카드번호가 아닌 마스킹 fixture를 기본으로 사용한다.

### 추가 서버 환경변수

```text
HYPHEN_USER_ID
HYPHEN_HKEY
HYPHEN_BASE_URL
HYPHEN_ENVIRONMENT=testbed|production
GOOGLE_CLOUD_PROJECT_ID
GOOGLE_VISION_CREDENTIALS_B64 또는 Workload Identity 설정
LLM_API_KEY
LLM_MODEL
INTEGRATION_ENCRYPTION_KEY
CARD_SYNC_CRON_SECRET
CARD_RAW_PAYLOAD_RETENTION_DAYS
RECEIPT_RETENTION_DAYS
```

`VITE_` 접두어를 붙이지 않는다. 프런트엔드에는 Supabase URL과 anon key 외 금융/OCR 비밀값을 절대 노출하지 않는다.

### 외부 준비물

#### 하이픈

- 법인카드 조회 상품 신청
- 테스트베드 권한
- User ID/HKey
- 실제 API 명세와 오류코드
- 카드사별 법인/개인사업자 인증 방식
- 건당 단가·호출 제한·조회 가능 기간
- 데이터 이용·재제공·보관에 관한 계약 조건

#### Google Cloud

- 전용 프로젝트와 결제 계정
- Vision API 활성화
- 최소 권한 서비스 계정
- 예산 경고와 일일 사용량 제한
- 한국 리전/데이터 처리 조건 검토

#### LLM

- 서버용 API 키
- JSON Schema 출력 지원 모델
- 입력·출력 보존 정책 확인
- 월 비용 한도와 실패 시 재시도 정책

## 5. 데이터베이스 구현안

### 5.1 연결

#### `timefit_user_card_connections`

- `id`, `organization_id`, `provider`
- `business_type`: corporation, sole_proprietor
- `status`: draft, authenticating, backfilling, reconciling, active, degraded, reauth_required, paused, disconnected
- `credential_reference_encrypted`
- `consent_version`, `consented_by`, `consented_at`
- `last_attempted_at`, `last_succeeded_at`, `next_sync_at`
- `last_error_code`, `last_error_category`
- `disconnected_at`, `created_at`, `updated_at`

고유 조건: 한 조직에서 동일 provider 연결을 중복 생성하지 않도록 활성 상태 partial unique index를 둔다.

#### `timefit_user_connection_assets`

- connection과 provider 카드 ID를 TimeFit 카드 ID에 매핑
- provider 카드 ID는 카드 끝 4자리와 별도로 저장
- 자동 발견, 선택, 제외 상태를 기록

### 5.2 카드 이벤트와 현재 상태

#### `timefit_user_card_transaction_events`

- 원천별 불변 레코드
- provider, provider_event_id, event_type
- approval, cancellation, partial_cancellation, acquisition, billing, payment
- 발생일시, 승인번호, 금액, 통화, 원거래 참조
- 가맹점명, 사업자번호, 원문 checksum
- raw payload storage reference

고유키: `(organization_id, provider, provider_event_id)`.

#### `timefit_user_card_transaction_groups`

- 한 결제의 현재 합성 상태
- approved_amount, acquired_amount, cancelled_amount, net_amount
- approved_at, acquired_at, billed_at
- pending/acquired/cancelled/partially_cancelled/billed
- merchant normalized fields
- reconciliation status

현재 `timefit_user_card_transactions`는 호환 뷰 또는 이관용 테이블로 유지한 뒤 새 화면 전환 후 제거 여부를 결정한다.

### 5.3 영수증과 처리

#### `timefit_user_expense_documents`

- 원본 storage path, SHA-256, MIME, 크기, 촬영 메타데이터
- 업로더, 카드 사용자 후보, 제출 사유
- processing status와 삭제/보존 만료일

#### `timefit_user_expense_processing_runs`

- vision request ID, OCR 버전, LLM 모델·prompt 버전
- OCR 원문 reference, 추출 JSON, 신뢰도
- 시작·종료 시각, 호출비용, 오류

같은 파일을 다시 처리해도 실행 이력은 새 행으로 남기고 현재 채택 결과를 문서에서 참조한다.

### 5.4 지출과 매칭

#### `timefit_user_expenses`

- 불변 ledger entry ID
- 거래일, 공급가액, 부가세, 합계, 통화
- 거래처, 계정과목, 태그, 사유, 사용 직원
- status: draft, review_required, confirmed, excluded, adjusted
- source confidence, confirmed_by/at

#### `timefit_user_expense_sources`

- 한 지출에 receipt, card, email, csv, tax_invoice를 N개 연결
- source type/id, 연결 사유, primary 여부

#### `timefit_user_expense_matches`

- 영수증과 카드 거래 후보
- 총점과 승인번호·금액·시간·가맹점·사업자번호별 점수
- suggested, confirmed, rejected, unlinked
- 확정/해제한 사용자와 시각

### 5.5 결산

#### `timefit_user_closeouts`

- daily, weekly, monthly, annual
- 기간, draft/ready/closed/reopened
- 매출, 카드 지출, 기타 지출, 인건비, 조정, 영업이익
- 원장 cutoff, snapshot version, checksum
- closed_by/at, reopen_reason

상세 합계는 `closeout_lines`에 계정과목·카드·거래처·직원 단위로 저장한다.

### 5.6 공통

- 모든 테이블에 `organization_id`, created/updated timestamps 적용
- 소유자/관리자 권한 RLS와 서버 재검증
- 금융 원문과 인증 참조는 일반 사용자에게 SELECT 권한을 주지 않음
- 병합·해제·확정·마감·재오픈을 감사 로그에 기록

## 6. 서버 API 구현안

### 카드 연결 API

| 엔드포인트 | 기능 | 권한 |
|---|---|---|
| `POST /api/card-connections` | 연결 초안·동의 생성 | 소유자 |
| `POST /api/card-connections/:id/authenticate` | provider 인증 시작/검증 | 소유자 |
| `GET /api/card-connections/:id/assets` | 보유카드 조회 | 소유자 |
| `POST /api/card-connections/:id/assets` | 사용할 카드 선택·등록 | 소유자 |
| `POST /api/card-connections/:id/backfill` | 최초 90일 동기화 | 소유자 |
| `POST /api/card-connections/:id/sync` | 수동 증분 동기화 | 소유자/관리자 |
| `POST /api/card-connections/:id/reauth` | 재인증 | 소유자 |
| `DELETE /api/card-connections/:id` | 연결 해제·인증 참조 파기 | 소유자 |
| `GET /api/card-connections/:id/health` | 최근 성공·오류·예정 조회 | 관리자 이상 |

동기화 요청은 즉시 긴 작업을 모두 수행하지 않고 작업 행을 생성한 뒤 worker가 처리하도록 설계한다. Vercel 실행시간 제한을 고려해 백필은 기간 단위로 나눈다.

### OCR API

| 엔드포인트 | 기능 |
|---|---|
| `POST /api/receipts/upload-intent` | 파일 형식·크기 검사와 업로드 경로 발급 |
| `POST /api/receipts/:id/process` | 품질 검사→Vision→LLM→규칙 검증 |
| `GET /api/receipts/:id` | 원본·추출 필드·처리 상태 조회 |
| `PATCH /api/receipts/:id` | 사용자 수정 |
| `POST /api/receipts/:id/confirm` | 지출 확정 또는 카드 거래 연결 |
| `POST /api/receipts/:id/retry` | 실패 단계부터 재처리 |

### 결산 API

- 기간별 draft 계산
- 예외 목록과 준비도 조회
- 마감 전 preview와 차이 설명
- close/reopen/adjust
- Excel/세무사 패키지 내보내기

## 7. Provider Adapter 명세

```text
CardProvider
  authenticate(input)
  refreshCredential(reference)
  listCards(reference)
  fetchApprovals(card, range, cursor)
  fetchAcquisitions(card, range, cursor)
  fetchBilling(card, period)
  normalize(raw)
  classifyError(error)
  disconnect(reference)
```

구현체는 `HyphenCardProvider`, `CsvCardProvider`, `EmailApprovalProvider`, `MockCardProvider`로 시작한다. 하이픈 명세 변경이 UI와 원장에 직접 전파되지 않도록 fixture 기반 contract test를 둔다.

### 오류 분류

- authentication: 재인증 필요
- provider_maintenance: 카드사 점검
- rate_limit: 호출 간격 조절
- invalid_request: 개발/명세 오류
- partial_response: 일부 기간 재조회
- timeout/network: 자동 재시도
- unknown: 원문 보호 후 운영 알림

## 8. 카드 동기화 구현

### 최초 연결

1. 보유카드를 조회한다.
2. 사용자가 카드와 담당자를 선택한다.
3. 최근 90일을 7~14일 구간으로 분할한다.
4. 승인과 매입을 각각 수집한다.
5. 원천 이벤트를 upsert한다.
6. 거래 그룹을 재계산한다.
7. 기존 CSV·영수증과 매칭한다.
8. 일별 순액 대조 결과를 생성한다.
9. 이상이 없으면 connection을 active로 전환한다.

### 정기 동기화

- 기본 6시간
- 활성 사용자 카드: 평일 영업시간 중 1시간
- 야간 최근 7일 재조회
- 월초 전월 매입·청구 전체 대조
- 수동 동기화 5분 쿨다운

### 작업 안전장치

- 조직+연결+데이터종류+기간 멱등 키
- advisory lock 또는 DB 작업 claim
- 페이지/기간별 커서 저장
- 성공한 구간은 재시도하지 않음
- 재시도는 exponential backoff+jitter
- 비용·호출 수·수집/갱신/중복 건수 기록

## 9. 영수증 촬영·OCR 구현

### 직원 화면

1. `영수증 촬영` 버튼
2. `accept="image/*" capture="environment"` 기반 후면 카메라 우선
3. 촬영 직후 회전·흐림·잘림·반사 안내
4. 재촬영 또는 제출
5. 지출 목적과 카드 선택은 선택 입력
6. 업로드 진행률과 오프라인 실패 복구

HEIC는 서버 또는 업로드 전 변환하고 JPEG/WebP 썸네일을 별도 생성한다. 원본은 삭제 정책에 따라 보존한다.

### 추출 JSON

```json
{
  "merchant_name": "",
  "merchant_business_number": "",
  "purchased_at": "",
  "total_amount": 0,
  "supply_amount": 0,
  "vat_amount": 0,
  "approval_number": "",
  "card_last4": "",
  "currency": "KRW",
  "line_items": [],
  "field_confidence": {},
  "warnings": []
}
```

LLM 결과는 JSON Schema로 제한한다. 총액=공급가액+부가세, 사업자번호 checksum, 미래 날짜, 음수·비정상 금액, OCR 원문 존재 여부는 코드로 검증한다.

### 처리 정책

- OCR/LLM 타임아웃은 문서를 실패로 버리지 않고 `재처리 필요`로 둔다.
- 동일 SHA-256 파일은 중복 경고를 표시한다.
- 관리자의 수정값을 학습 데이터로 바로 보내지 않는다.
- 낮은 신뢰도 필드만 강조하고 전체 재입력을 요구하지 않는다.

## 10. 자동 매칭과 중복 방지

### 후보 점수 예시

| 조건 | 점수 |
|---|---:|
| 승인번호 정확 일치 | +60 |
| 금액 정확 일치 | +25 |
| 결제시각 ±30분 | +10 |
| 카드 끝 4자리 일치 | +10 |
| 사업자번호 일치 | +20 |
| 가맹점명 유사 | +5 |
| 이미 다른 영수증 확정 연결 | -100 |

- 90점 이상, 단일 후보: 자동 추천
- 70~89점: 관리자 비교 확인
- 70점 미만 또는 복수 유사 후보: 미매칭

초기 출시에는 자동 추천만 하고 자동 확정하지 않는다. 운영 데이터에서 오매칭률 0.5% 미만과 오합산 0건을 확인한 조직부터 조건부 자동 확정을 연다.

## 11. 화면 구현 기능안

### 관리자 `지출·증빙`

- 상단 KPI: 이번 달 지출, 카드 순이용액, 미증빙, 확인 필요
- 탭: 전체 지출 / 영수증 검토 / 법인카드 / 자동화 규칙
- 필터: 기간, 매장, 직원, 카드, 계정과목, 증빙 상태
- 지출 상세: 원천 타임라인, 영수증, 카드 이벤트, 수정·병합·해제 기록

### `법인카드`

- 주요 CTA: `카드사 자동 연결`
- 보조 CTA: `카드 수동 등록`, `CSV 가져오기`
- 연결 카드: 카드사·별칭·끝4자리·담당자·상태·최근/다음 동기화
- 요약: 승인, 취소, 순이용, 미매입, 미증빙
- 상태별 조치: 지금 동기화, 재인증, 오류 기간 재조회, 연결 해제

### `확인 필요함`

- 미증빙 카드 거래
- 카드 거래 없는 영수증
- 중복 의심
- 승인/매입 금액 차이
- OCR 저신뢰
- 담당자·사유·계정과목 미확정
- 동기화 실패·인증 만료

### 직원 `영수증 제출`

- 촬영·갤러리 선택
- 사진 확인
- 지출 목적 간단 입력
- 제출 상태와 수정 요청
- 본인 미제출 카드 거래 목록

### `결산`

- 일간, 주간, 월간, 연말
- 매출·지출·인건비·영업이익
- 잠정/확정 구분
- 마감 준비도와 차이 원인
- 마감, 재오픈, 조정, 내보내기

## 12. 개발 로드맵

아래 일정은 2명 기준 약 14주다. 1명 전담이면 18~22주를 예상하며, 하이픈 계약/심사 기간은 개발 일정과 별도다.

### Sprint 0 — 계약·설계 고정 (1주)

- 하이픈 상품·테스트베드 신청
- 카드사별 인증/응답 필드 확인
- 개인정보 흐름·보존정책 확정
- DB ERD, API contract, 화면 wireframe 승인
- fixture와 테스트 조직 준비

완료 조건: 미확정 필드 목록과 공급자 의존성이 문서화됨.

### Sprint 1 — 원장과 카드 이벤트 기반 (2주)

- 연결·asset·sync·event·group·expense 테이블
- RLS, 감사 로그, migration/rollback 검증
- 기존 카드·CSV 데이터 이관
- Provider interface와 mock provider
- 카드 화면 명칭·정보구조 개편

완료 조건: mock 승인→부분취소→매입이 한 거래와 한 지출로 계산됨.

### Sprint 2 — 무료 폴백 완성 (1주)

- CSV 매핑·미리보기·오류 다운로드
- 파일/행 멱등 처리
- 이메일 provider 골격
- 재업로드·부분 실패 복구

완료 조건: 같은 파일 3회 업로드 시 합계 불변.

### Sprint 3 — 하이픈 자동 연결 (3주)

- OAuth 토큰 캐시와 provider adapter
- 연결 동의·인증·보유카드 조회
- 카드 선택·담당자 지정·자동 등록
- 90일 백필 worker와 진행률
- 정기 동기화·상태·재인증·연결 해제
- 호출량·비용·오류 모니터링

완료 조건: 테스트 카드가 자동 등록되고 승인·취소·매입을 재실행해도 중복 없음.

### Sprint 4 — 영수증 촬영과 AI (3주)

- 모바일 촬영·업로드·재시도
- 비공개 Storage 정책
- 이미지 품질/변환
- Vision OCR, LLM JSON, 규칙 검증
- 관리자 비교 검수 화면
- 카드 거래 매칭 후보와 병합/해제

완료 조건: 대표 영수증 fixture 세트의 필수 필드 정확도와 오류 UX 통과.

### Sprint 5 — 예외 업무와 자동화 (2주)

- 확인 필요함 통합 업무함
- 가맹점·카드별 분류 규칙
- 담당 직원 알림과 미제출 리마인드
- 일괄 승인·수정
- 관리자 처리시간 측정

완료 조건: 정상 건이 업무함을 차지하지 않고 예외만 처리 가능.

### Sprint 6 — 통합 결산 (2주)

- Toss Place 매출·급여·지출 원장 결합
- 일간/주간/월간/연말 draft
- 마감 잠금·snapshot·재오픈·조정
- Excel/세무사 내보내기
- 결산 숫자 drill-down

완료 조건: 모든 합계가 원천 거래로 역추적되고 마감 후 숫자가 자동 변경되지 않음.

### Pilot — 병행 운영 (최소 2주)

- 내부 사업장 1곳, 카드 1장
- API와 카드사 CSV 일별 순액 비교
- 승인·취소·부분취소·지연매입 확인
- OCR 오차·매칭 오차·관리시간 측정
- 장애·재인증·CSV 폴백 훈련

완료 조건: 오합산 0건, 중복 0건, 심각 보안 이슈 0건.

## 13. 테스트 전략

### 자동화 테스트

- 단위: 정규화, 금액, 날짜, 중복키, 매칭 점수
- contract: 하이픈 fixture별 요청/응답과 오류 분류
- DB: RLS, unique constraints, 병합·취소 계산
- API: 인증·조직 권한·멱등성·재시도
- E2E: 연결→자동등록→조회→영수증→결산

현재 package에는 테스트 runner가 없으므로 Vitest와 React Testing Library를 추가하고, E2E에는 Playwright를 도입한다.

### 필수 회귀 시나리오

- 동일 승인 이메일·CSV·API 중복 유입
- 전체취소/부분취소/승인월과 매입월 차이
- 해외 승인과 환율 변경
- 재인증 후 누락기간 백필
- 카드사 점검과 partial response
- 영수증 선행/카드 거래 선행
- 마감 후 취소 도착
- 조직 간 파일·카드·거래 접근 차단

### 성능 목표

- 카드 목록/월 거래 화면 p95 2초 이내
- 영수증 업로드 시작 1초 이내
- 일반 OCR 결과 60초 이내
- 월 10,000거래 조직의 결산 draft 30초 이내
- 동기화 작업 재실행 시 중복 0건

## 14. 배포와 운영

### 배포 순서

1. backward-compatible DB migration
2. 서버 API와 mock/CSV provider
3. 새 화면을 feature flag 뒤에 배포
4. 하이픈 테스트베드 연결
5. QA 조직에서 백필·대조
6. 내부 pilot 조직만 flag 활성화
7. 2주 검증 후 제한 출시
8. 오류·비용 지표 확인 후 점진 확대

### Feature flags

- `expense_ledger_v2`
- `receipt_capture`
- `receipt_ai_processing`
- `card_auto_connection`
- `card_auto_sync`
- `auto_expense_confirmation`
- `closeout_v2`

자동 확정 플래그는 기본 OFF다.

### 모니터링

- 연결 정상률, 마지막 성공 경과시간
- 공급자/카드사별 오류율
- 동기화 호출 수·추정 비용·재시도 수
- 수집 신규/갱신/중복/실패 건수
- OCR 성공률·필드별 수정률
- 카드·영수증 매칭률·해제율
- 미증빙·미확정 잔량과 평균 처리시간
- 결산 재오픈·조정 횟수

### 운영 알림

- 즉시: 인증정보 노출 가능성, 조직 격리 실패, 중복 결산 발생
- 1시간 내: 동기화 연속 실패, 대량 합계 차이
- 일간 요약: 재인증, 미증빙, OCR 실패
- 비용 경고: 월 예산 70%, 90%, 100%

## 15. 역할과 산출물

### 프런트엔드

- 카드 연결 마법사와 상태 화면
- 영수증 모바일 촬영/검수
- 예외 업무함과 결산 화면
- 접근성·반응형·오류 복구 UX

### 백엔드

- Provider Adapter와 하이픈 연동
- OCR/LLM 파이프라인
- 동기화 worker/Cron
- 중복·매칭·원장·결산 API

### 데이터/DB

- migration, RLS, 이벤트/원장 모델
- 백필·이관·정합성 query
- 결산 snapshot과 감사 로그

### QA/운영

- 카드사/거래유형 fixture
- Pilot 대조표와 UAT
- 장애·재인증 runbook
- 비용·품질 dashboard

## 16. 비용 통제안

### 고정·변동비

- 하이픈: 공개 기준 TR슬림 월 10만원+정상응답 건별, TR시그니처 월 30만원부터
- Google Vision: 이미지 호출량 기반
- LLM: 입력/출력 토큰 기반
- Storage: 원본 크기·보존기간 기반
- Vercel/Supabase: API·DB·egress·Cron 부하 기반

### 절감 방법

- 활성 카드만 1시간 주기, 나머지는 6시간
- 성공 커서 이후만 조회하고 최근 7일만 재대조
- 이미지 품질 불량은 Vision 호출 전에 차단
- OCR 원문이 충분하면 LLM 입력을 최소화
- 파일 SHA-256으로 중복 OCR 방지
- 원본 보존기간과 썸네일 장기 보존을 분리
- 조직별 월 사용량 한도와 관리자 경고

## 17. 출시 Go/No-Go

### Go

- 하이픈 계약상 고객 데이터 활용이 허용됨
- 인증정보를 TimeFit이 평문 장기 보관하지 않음
- 핵심 카드사의 보유카드·승인·취소·매입 검증 완료
- API와 CSV 2주 대조 오합산 0건
- 같은 거래의 복수 원천 유입 중복 0건
- 조직 격리와 연결 해제/파기 테스트 통과
- 관리자 예외 업무만으로 월마감 가능

### No-Go

- 복호화 가능한 카드 비밀번호/인증서 비밀번호 장기 보관 필수
- 고유 거래키 또는 취소 연결정보가 없어 중복 방지 불가
- 핵심 카드사 미지원 또는 장기 장애 SLA 부재
- 계약상 최종 고객 제공·결산 활용 불가
- 마감 결과를 원천으로 역추적할 수 없음

## 18. 바로 시작할 개발 백로그

### P0

1. 하이픈 테스트베드·명세·견적 확보
2. 카드 연결/이벤트/그룹/지출 DB migration 작성
3. 기존 카드 테이블 이관 전략과 rollback 작성
4. Provider interface와 mock fixture 구현
5. 카드 화면 CTA를 자동 연결/수동 등록으로 분리
6. 카드 연결 상태와 최근 동기화 UI 구현
7. CSV parser를 새 이벤트 모델로 이전
8. 중복·취소·부분취소 단위 테스트 추가

### P1

9. 하이픈 OAuth/보유카드/승인/매입 adapter
10. 백필 작업 큐와 Cron
11. 촬영 업로드와 Storage/RLS
12. Vision OCR/LLM 구조화
13. 매칭 후보와 관리자 검수
14. 확인 필요함 업무함

### P2

15. 자동 분류 규칙
16. 결산 snapshot·마감·재오픈
17. 세무 내보내기
18. 비용·품질 모니터링

## 19. 의사결정이 필요한 항목

개발은 아래 기본값으로 시작하되 계약/운영 결정 시 확정한다.

| 항목 | 권장 기본값 |
|---|---|
| 자동조회 주기 | 기본 6시간, 활성 카드 영업시간 1시간 |
| 최초 백필 | 최근 90일 |
| 월 결산 카드 기준 | 매입액, 미매입은 잠정 표시 |
| 자동 매칭 | 추천만, 관리자 확정 |
| 자동 지출 확정 | 초기 OFF |
| 원본 영수증 보존 | 세무·법무 검토 후 조직 정책화 |
| 연결 가능 권한 | 조직 소유자만 |
| 연결 해제 | 인증 파기, 과거 원장 유지 |
| 수동 새로고침 | 5분 쿨다운 |
| Pilot | 내부 사업장 1곳·카드 1장·2주 이상 |

## 20. 최종 실행 순서

```text
하이픈 권한 확보
→ DB/Provider 기반
→ 카드 자동 연결·등록
→ 승인·취소·매입 자동조회
→ CSV 병행 대조
→ 영수증 촬영·OCR
→ 카드·영수증 자동 매칭
→ 예외 업무함
→ 매출·인건비 통합 결산
→ 2주 Pilot
→ 제한 출시
→ 점진 확대
```

첫 개발 마일스톤은 화면 모형이 아니라 **테스트 카드 한 장이 자동 등록되고 승인·취소·매입을 중복 없이 자동 조회하는 것**으로 정의한다.

## 21. 보고·순익 산식 상세 명세

### 명칭 원칙

1차 출시에서는 법인세, 감가상각, 금융손익, 완전한 매출원가가 포함되지 않으므로 회계상 `당기순이익`이라고 표시하지 않는다. 제품의 핵심 숫자는 `운영순익(추정)`으로 표시한다.

```text
총매출
- 매출취소
- 할인
= 순매출

순매출
- 확정 운영지출
- 실제 인건비
= 운영순익(추정)
```

재고·원재료 매입원가가 구현된 조직은 별도 설정으로 다음 산식을 사용한다.

```text
순매출 - 매출원가 - 운영지출 - 실제 인건비 = 영업이익(추정)
```

다음 항목은 숫자 옆에 별도로 표시한다.

- 미매입 카드 승인액: 잠정 지출
- 미확정 OCR 지출: 검토 대기, 기본 합계 제외
- 예상 인건비: 실제 인건비와 구분
- 매출 연동 실패: 마지막 정상 집계 시각과 누락 배지
- 증빙 없는 카드 지출: 지출에는 포함하되 증빙 완결성에서 경고

### 귀속 기준

| 데이터 | 운영 화면 | 월마감 기본값 |
|---|---|---|
| POS 매출 | 주문/취소 발생 영업일 | 주문 기준 순매출 |
| 카드 지출 | 승인일 잠정 | 매입일 확정 |
| 카드 취소 | 취소일 표시+원거래 영향 | 원거래 조정 또는 마감 후 조정 |
| 현금/수기 지출 | 지출 발생일 | 관리자 확정일이 아닌 거래일 |
| 인건비 | 출퇴근 기반 당일 추정 | 확정 급여를 기간 안분 |

조직 설정에 영업일 마감 시각, 주 시작 요일, 카드 지출 귀속 기준을 둔다. 기본 시간대는 `Asia/Seoul`, 주 시작은 월요일, 심야 영업은 설정된 마감 시각 이전을 전 영업일로 귀속한다.

## 22. 일간·주간·월간·연말 보고서

### 일간 운영보고

자동 생성: 영업 종료 후 30분, 다음 날 오전 재계산.  
목적: 어제 장사가 실제로 얼마나 남았고 무엇을 확인해야 하는지 1분 안에 판단.

필수 구성:

- 총매출, 취소·할인, 순매출
- 카드/현금/기타 결제수단별 매출
- 확정 운영지출, 잠정 카드지출, 실제/예상 인건비
- 운영순익(추정), 순익률
- 영업시간당 매출·운영순익
- 증빙 완료율과 미증빙 카드 건수
- POS·카드 동기화 상태와 마지막 성공 시각
- 전일 대비와 최근 4주 동일 요일 대비
- 확인 필요 항목과 바로 처리 버튼

### 주간 경영보고

자동 생성: 조직의 주 마지막 날 종료 후 다음 새벽.  
목적: 요일별 성과와 비용 이상을 발견하고 다음 주 스케줄을 조정.

필수 구성:

- 일별 순매출·지출·인건비·운영순익 추이
- 전주 대비 금액/증감률
- 요일별 평균과 최고/최저 영업일
- 계정과목·가맹점·카드·직원별 지출 상위 항목
- 예정 인건비 대비 실제 인건비 차이
- 미증빙·미매칭·OCR 실패 누적
- 이미 확정된 일간 보고 합계와 주간 원장 재집계 차이
- 다음 주 조치 추천: 인력 과다시간, 반복 고액지출, 증빙 요청

### 월간 결산보고

초안 생성: 익월 1일. 카드 매입·급여 확정에 따라 자동 보정 후 권한자가 마감.  
목적: 매장 손익, 비용 구조, 증빙 완결성을 확정하고 세무 전달 자료를 생성.

필수 구성:

- 월 순매출, 확정 지출, 실제 인건비, 운영순익(추정), 순익률
- 전월 및 전년 동월 대비
- 일별/주별 추이와 누적선
- 계정과목·거래처·카드·직원별 구성
- 고정비/변동비 구분
- 카드 승인·취소·매입·미매입·결제예정
- 증빙 완료율, 미증빙, 검토 대기, 중복 제외
- 매출/카드/급여 연결 신선도
- 조정·재오픈 이력
- 세무사 전달용 증빙 인덱스

마감 전 차단 또는 경고 조건:

- 동기화 누락 기간
- 해결되지 않은 중복 의심
- 매입 대조 차이
- 확정되지 않은 고액 지출
- 급여 미확정
- POS 일별 합계 불일치

권한자는 경고가 남아 있어도 사유를 입력해 마감할 수 있으며, 해당 사유와 누락 목록은 스냅샷에 포함한다.

### 연말 경영보고

생성 조건: 12개 월마감 상태 점검 후 초안 생성.  
목적: 연간 운영 성과와 비용 구조를 비교하고 세무·경영 자료를 보존.

필수 구성:

- 월별 순매출·지출·인건비·운영순익 추이
- 전년 대비와 월별 성장률
- 계정과목·거래처·카드·직원별 연간 합계
- 증빙 완결성과 월별 미증빙 추이
- 카드 연결 장애·수기 폴백·조정 이력
- 마감·재오픈 이력
- 세무 원장과 증빙 파일 인덱스

연말 보고는 세무 신고서가 아니며, 신고를 위한 자료 집계·전달물이라는 안내를 표시한다.

## 23. 순익 대시보드와 차트 명세

### 공통 UX

- 모든 차트는 일/주/월/연 사용자 기간을 지원한다.
- 확정값은 실선·진한색, 잠정값은 점선·연한색으로 구분한다.
- 범례와 툴팁만 색으로 구분하지 않고 텍스트/패턴을 함께 사용한다.
- 차트 점을 누르면 구성 지출 목록, 거래, 원본 영수증까지 drill-down한다.
- 데이터가 일부 누락되면 선을 정상값처럼 연결하지 않고 해당 구간에 경고를 표시한다.
- 화면 KPI, 차트, 다운로드 보고서는 같은 집계 API와 snapshot version을 사용한다.

### 필수 차트

| 차트 | 유형 | 핵심 데이터 | 사용 위치 |
|---|---|---|---|
| 매출·지출·인건비·운영순익 | 다중선/막대 조합 | 기간별 네 지표 | 일·주·월·연 |
| 운영순익률 | 선 | 운영순익/순매출 | 주·월·연 |
| 비용 구성 | 누적 막대 | 인건비·고정비·변동비·기타 | 월·연 |
| 계정과목별 지출 | 가로 막대 | 상위 카테고리와 기타 | 주·월·연 |
| 증빙 완결성 | 100% 누적 막대 | 완료·미증빙·검토대기 | 일·주·월 |
| 카드 상태 | 막대 | 승인·취소·매입·미매입 | 일·월 |
| 예상/실제 인건비 | 비교 막대 | 스케줄·출퇴근·급여 | 주·월 |
| 누적 운영순익 | 누적선 | 월중/연중 누적 | 월·연 |

원형 차트는 항목이 5개 이하일 때만 사용한다. 거래처·계정과목이 많으면 순위형 막대와 `기타` 묶음을 사용한다.

### 차트 API 응답 기준

```json
{
  "period": {"type": "monthly", "start": "", "end": "", "timezone": "Asia/Seoul"},
  "snapshot_version": 1,
  "status": "draft",
  "series": [],
  "totals": {},
  "comparison": {},
  "data_quality": {
    "sales_last_synced_at": "",
    "cards_last_synced_at": "",
    "pending_expense_count": 0,
    "missing_ranges": []
  }
}
```

금액은 DB/API에서는 정수 원 단위로 유지하고 화면에서만 포맷한다. 비율 계산 시 분모 0을 명시적으로 처리한다.

## 24. 결산 보고서 생성·보관·전달

### 출력 형식

- 웹 보고서: 탐색과 drill-down용
- PDF: 경영 보고·결재·보관용
- Excel: 원장 검토·세무사 전달용
- ZIP: Excel, PDF, 증빙 인덱스, 선택한 원본 증빙 묶음

### PDF 구성

1. 표지: 조직·매장·기간·상태·버전·생성자
2. 핵심 요약: 순매출·지출·인건비·운영순익·증빙률
3. 기간 추이 차트
4. 비용 구성과 상위 증감 요인
5. 카드·증빙 정합성
6. 예외·조정·재오픈 내역
7. 데이터 기준과 마지막 동기화 시각

### Excel 구성

- `요약`
- `매출 원장`
- `지출 원장`
- `카드 거래`
- `증빙 인덱스`
- `인건비`
- `미처리·예외`
- `조정·감사 이력`

모든 sheet의 합계가 요약과 일치해야 하며 원장 행에는 내부 ledger entry ID와 원천 참조를 포함한다.

### 생성 규칙

- draft 보고서는 원장 변경 시 다시 생성할 수 있다.
- closed 보고서는 snapshot version에 고정하고 같은 버전을 다시 내려받을 수 있다.
- 재오픈 후 새로 마감하면 버전을 증가시키고 이전 파일을 유지한다.
- 파일명에 조직, 기간, 상태, 버전, 생성시각을 포함한다.
- 다운로드는 만료되는 signed URL을 사용하고 생성·다운로드 이력을 기록한다.
- 세무사 이메일 발송은 최종 확인 화면에서 수신자, 기간, 첨부 목록을 검토한 뒤 실행한다.

### 보고서 테스트

1. 화면 KPI, 차트 합계, PDF, Excel 합계가 동일하다.
2. 일간 합계와 주간/월간 원장 재집계가 일치한다.
3. 승인 취소와 부분취소 순액이 모든 출력에서 동일하다.
4. draft 변경은 반영되고 closed 버전은 변하지 않는다.
5. 재오픈 전후 보고서를 각각 재다운로드할 수 있다.
6. 누락 데이터와 잠정값이 보고서에서 숨겨지지 않는다.
7. 다른 조직은 보고서와 signed URL에 접근할 수 없다.
8. PDF 한글, 표, 차트, 페이지 분할이 깨지지 않는다.
