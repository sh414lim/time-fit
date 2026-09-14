# TimeFit 카드사 인증 Connector·거래내역 수집 엔진 기획

## 1. 목표

TimeFit 플랫폼 안에서 고객이 법인 공동인증서 또는 카드사 기업 계정으로 인증하고, 보유 법인카드를 자동 등록한 뒤 승인·취소·매입내역을 지속적으로 동기화하는 자체 Provider를 구축한다.

첫 출시 범위는 다음으로 제한한다.

- 한국 법인사업자
- 법인공용카드 우선
- 카드사 1곳
- 공동인증서 또는 기업 ID/PW 중 실제 검증된 인증 방식 1개
- 보유카드, 승인, 전체취소, 부분취소, 매입
- 최근 90일 최초 수집
- 이후 30~60분 승인 증분 수집
- CSV 대사

청구, 한도, 포인트, 개인카드, 결제·송금은 후속 범위다.

## 2. 사용자 흐름

```text
1. TimeFit 로그인
2. 설정 > 법인카드 > 카드 연결
3. 카드정보 수집·보관·해제 동의
4. 사업자번호 확인
5. 카드사 선택
6. 공동인증서 또는 기업 ID 인증
7. 필요 시 휴대전화·앱·OTP 추가 인증
8. 보유카드 자동 조회
9. 자동 수집할 카드 선택
10. 카드별 담당 직원·부서·매장 지정
11. 최근 90일 수집 시작
12. CSV 대사
13. 자동 동기화 활성화
```

인증 중 카드사 외부 화면으로 이동하지 않고 TimeFit modal 내부에서 진행한다. 단, PC 인증서 접근에 로컬 보안모듈이 필요하면 TimeFit UI가 해당 모듈을 호출하고 진행 상태를 표시한다.

## 3. 전체 구조

```text
[TimeFit Web]
        │
[Connection API]
        │
[Authentication Orchestrator]
        ├── [Credential Broker] ── [Vault/KMS]
        └── [Challenge Store]
        │
[Job Queue]
        │
[Connector Runtime Pool]
        ├── Samsung Connector v1
        ├── Hyundai Connector v1
        └── ...
        │
[Raw Validator / Normalizer]
        │
[Immutable Card Events]
        │
[Transaction Grouper]
        │
[Expense Ledger]
```

일반 API 서버, 인증정보 저장소, 카드사 접속 실행기와 원장 처리기를 분리한다. 카드사 Connector는 TimeFit 업무 DB에 직접 접근하지 않고 표준 결과만 반환한다.

## 4. 카드사 Connector 공통 규격

### 4.1 Connector Manifest

카드사별 설정을 코드에 흩어놓지 않고 manifest로 관리한다.

```typescript
type ConnectorManifest = {
  connectorId: string;
  issuerCode: string;
  version: string;
  status: 'pilot' | 'active' | 'degraded' | 'disabled';
  supportedBusinessTypes: ('corporation' | 'sole_proprietor')[];
  authMethods: AuthMethodSchema[];
  capabilities: {
    cards: boolean;
    approvals: boolean;
    cancellations: boolean;
    acquisitions: boolean;
    billing: boolean;
    limits: boolean;
  };
  maxRangeDays: number;
  minimumIntervalSeconds: number;
  maintenanceWindows: MaintenanceWindow[];
};
```

UI는 manifest를 읽어 카드사별 입력 화면을 동적으로 만든다.

### 4.2 Connector Interface

```typescript
interface CardIssuerConnector {
  manifest(): ConnectorManifest;
  beginAuth(input: BeginAuthInput): Promise<AuthResult>;
  continueAuth(input: ChallengeInput): Promise<AuthResult>;
  discoverCards(session: SessionRef): Promise<CardAssetPage>;
  fetchApprovals(query: EventQuery): Promise<EventPage>;
  fetchAcquisitions(query: EventQuery): Promise<EventPage>;
  fetchBilling?(query: EventQuery): Promise<EventPage>;
  logout(session: SessionRef): Promise<void>;
  healthCheck(): Promise<HealthResult>;
}
```

### 4.3 Connector 반환 원칙

- 카드사 원본 응답을 그대로 DB에 저장하지 않는다.
- 정상화 전 schema 검증을 통과해야 한다.
- 전체 카드번호는 Connector Runtime 밖으로 전달하지 않는다.
- 오류는 공통 오류코드로 변환한다.
- 결과에 connector version과 source received time을 포함한다.
- 한 페이지 단위로 반환해 중단 지점부터 재개할 수 있게 한다.

## 5. 인증 엔진

### 5.1 지원 인증 방식

#### 기업 ID/PW

- TimeFit 안에서 카드사 기업 ID와 비밀번호 입력
- TLS로 Authentication Orchestrator에 전달
- Vault에 저장하거나 1회 인증 후 폐기
- 카드사 세션이 장기 재사용 가능한지 검증

#### 공동인증서

- 인증서 파일 직접 선택 또는 TimeFit 로컬 모듈로 탐색
- 인증서 유효기간, 사업자번호, 발급자 확인
- 비밀번호는 브라우저/로컬 모듈에서 먼저 검증
- 카드사 로그인에 필요한 범위에서만 사용
- 자동 동기화에 필요한 경우 별도 보관 동의와 Vault 정책 적용

#### 추가 인증

- SMS OTP
- 카드사 앱 승인
- ARS
- 보안질문

CAPTCHA 또는 사용자 확인이 필요한 단계는 우회하지 않고 `challenge_required`로 전환한다.

### 5.2 인증 상태 머신

```text
created
→ validating_input
→ authenticating
→ challenge_required
→ authenticated
→ discovering_cards
→ completed

실패:
invalid_credentials
certificate_expired
challenge_expired
account_locked
maintenance
schema_changed
user_cancelled
```

### 5.3 Challenge 처리

```text
카드사 추가 인증 감지
→ challenge ID 생성
→ TimeFit 화면에 인증 요청
→ 사용자가 OTP/앱승인 완료
→ 기존 Connector session으로 이어서 실행
→ 성공 후 challenge와 입력값 폐기
```

Challenge TTL은 기본 3~5분으로 하고 카드사 제한을 따른다. 인증 실패 횟수를 제한해 카드사 계정 잠금을 방지한다.

### 5.4 Credential Broker

Connector Runtime이 Vault를 직접 자유롭게 조회하지 못하게 중개한다.

요청 검증:

- organization ID
- connection ID
- job ID
- connector ID/version
- 사용 목적
- TTL
- job lease 보유 여부

정상 작업에만 짧은 시간의 credential handle을 제공하고 값은 로그·오류·metric에 포함하지 않는다.

## 6. 보유카드 수집 엔진

### 6.1 표준 카드 모델

```typescript
type DiscoveredCard = {
  providerAssetToken: string;
  issuerCode: string;
  displayName: string;
  last4: string;
  cardType: 'corporate_shared' | 'corporate_assigned' | 'unknown';
  status: 'active' | 'inactive' | 'reissued' | 'unknown';
  validThrough?: string;
  sourceFingerprint: string;
};
```

### 6.2 카드 식별

우선순위:

1. 카드사가 제공하는 비민감 고유 카드 ID
2. 카드사가 제공하는 마스킹 카드번호 기반 안정 ID
3. 격리 Runtime에서 생성한 조직별 keyed HMAC

전체 PAN은 일반 애플리케이션 서버·DB·Queue에 넣지 않는다. 카드사가 전체 PAN만 제공하면 Runtime 메모리에서 HMAC과 last4를 만든 직후 원문을 제거한다.

### 6.3 중복·재발급

- 같은 token 재발견: 기존 카드 갱신
- 동일 last4만 같음: 자동 병합 금지
- 재발급 관계가 제공됨: 이전 카드와 `reissued_from` 연결
- 새 카드 발견: 관리자 확인 전 `discovered`
- 해지 카드: 과거 원장은 유지하고 `inactive`

## 7. 거래내역 수집 엔진

### 7.1 수집 데이터

- 승인
- 전체취소
- 부분취소
- 매입
- 매입취소
- 후속 범위: 청구·결제예정·한도

### 7.2 표준 이벤트

```typescript
type CardEvent = {
  providerEventId: string;
  idempotencyKey: string;
  groupKey?: string;
  eventType:
    | 'approval'
    | 'cancellation'
    | 'partial_cancellation'
    | 'acquisition'
    | 'acquisition_cancellation'
    | 'billing';
  occurredAt: string;
  receivedAt: string;
  amount: number;
  currency: string;
  foreignAmount?: number;
  approvalNumber?: string;
  originalEventReference?: string;
  merchantName?: string;
  merchantBusinessNumber?: string;
  merchantCategoryCode?: string;
  installmentMonths?: number;
  schemaVersion: string;
};
```

### 7.3 작업 분할

작업 단위:

```text
organization
× connection
× corporate card
× event type
× date range
× page/cursor
```

첫 90일은 카드사 제한에 따라 7~30일 구간으로 나눈다. 각 page 성공 후 cursor와 `succeeded_through`를 갱신한다.

### 7.4 실행 주기

| 데이터 | 권장 주기 | 재조회 범위 |
| --- | --- | --- |
| 승인·취소 | 30~60분 | 최근 7일 overlap |
| 매입·매입취소 | 3~6시간 | 최근 14일 overlap |
| 청구 | 일 1회 | 당월+직전월 |
| 카드 목록 | 일 1회 | 전체 |
| 월말 보정 | 일 1회 | 최근 30일 |

동기화 주기는 카드사 호출 제한, 고객 요금제와 운영 원가에 따라 조정한다.

### 7.5 멱등성

카드사가 안정적인 거래 ID를 제공하면 이를 우선 사용한다. 없으면 다음 필드의 keyed hash로 fallback을 생성한다.

```text
issuer + cardToken + eventType + occurredAt
+ amount + approvalNumber + originalReference
+ normalizedMerchant
```

동일 기간을 여러 번 조회해도 immutable event가 중복 저장되지 않아야 한다.

### 7.6 거래 그룹 합성

```text
승인 100,000
  ├─ 부분취소 20,000
  └─ 매입 80,000
       ↓
최종 순액 80,000 / partially_cancelled / acquired
```

승인번호, 원승인번호, 카드 token, 금액과 시간 근접도를 이용한다. 확신이 낮으면 자동 결합하지 않고 대사 예외함으로 보낸다.

## 8. Queue·Worker 구조

### 8.1 Queue 상태

```text
queued
→ leased
→ running
→ succeeded

예외:
retry_scheduled
challenge_required
partial
failed
cancelled
dead_letter
```

### 8.2 Worker 실행 원칙

- 한 Worker는 한 카드사 Connector version만 로드 가능
- 작업마다 격리 실행 환경 생성 권장
- organization/connection/card 단위 중복 실행 차단
- 카드사별 global concurrency 제한
- heartbeat와 lease 만료로 중단 작업 회수
- 작업 제한시간 이전에 다음 page job을 생성하고 종료
- 카드사 응답 원문은 최소 보존 또는 checksum만 저장

### 8.3 재시도 정책

| 오류 | 처리 |
| --- | --- |
| 잘못된 인증정보 | 자동 재시도 중단, 재인증 요청 |
| 인증서 만료 | 자동 재시도 중단, 새 인증서 요청 |
| OTP/앱 승인 | challenge 생성 |
| 429/호출 제한 | Retry-After 또는 지수 backoff |
| 카드사 점검 | 점검 종료 후 예약 |
| 네트워크 timeout | 제한된 횟수 재시도 |
| schema 변경 | Connector 즉시 차단, 운영 경보 |
| 일부 페이지 실패 | 성공 cursor 보존, 실패 page 재개 |

## 9. 카드사 화면 변경 대응

자체 Connector의 가장 큰 운영 위험이다.

필수 장치:

- 카드사별 합성 health check
- 로그인/카드/거래 응답 schema fingerprint
- 필수 selector와 field 존재 검증
- connector version별 fixture replay
- 오류율 급증 자동 경보
- 카드사별 kill switch
- 이전 version 즉시 rollback
- 고객 화면에 영향 범위와 다음 조치 표시

schema mismatch에서 빈 배열을 정상 결과로 저장하면 안 된다. 기존 카드와 거래가 모두 사라진 것처럼 오판할 수 있으므로 `schema_changed` 오류로 중단한다.

## 10. 데이터 모델 추가안

```text
card_connector_definitions
card_connector_versions
card_credentials
card_auth_challenges
card_connector_sessions
card_collection_jobs
card_job_attempts
card_source_deliveries
card_reconciliations
card_reconciliation_items
card_connector_incidents
```

기존 테이블은 유지한다.

- `timefit_user_card_connections`
- `timefit_user_connection_assets`
- `timefit_user_corporate_cards`
- `timefit_user_card_sync_runs`
- `timefit_user_card_sync_cursors`
- `timefit_user_card_transaction_events`
- `timefit_user_card_transaction_groups`
- `timefit_user_expenses`

모든 신규 테이블은 `organization_id`를 직접 보유하고 참조 객체와 조직이 일치하도록 복합 제약 또는 RPC 검증을 적용한다.

## 11. TimeFit 화면 기획

### 11.1 연결 시작

- 지원 카드사 로고/이름
- 정상·점검·Pilot·준비중 상태
- 지원 데이터와 예상 동기화 주기
- 공동인증서/ID 로그인 가능 여부

### 11.2 인증 modal

- 사업자번호
- 인증 방식
- 인증서 선택 또는 ID/PW
- 추가 인증 진행 상태
- 인증정보 저장 여부와 보안 안내
- 오류 원인과 계정 잠금 주의

### 11.3 카드 선택

- 카드사·상품명·last4
- 공용/개별
- 활성/해지/신규 발견
- 담당자·부서·매장 선택
- 전체 선택과 검색

### 11.4 최초 수집

- 카드별 진행률
- 수집 기간
- 승인/취소/매입 건수
- 실패 카드와 재시도 상태
- 화면을 닫아도 계속된다는 안내

### 11.5 연결 관리

- 최근 성공 시각
- 다음 동기화
- 마지막 대사 결과
- 재인증
- 지금 동기화
- 일시정지
- 연결 해제

## 12. 보안 요구사항

- 전체 PAN·CVC·카드 비밀번호 저장 금지
- 인증정보 일반 DB·로그·analytics 전송 금지
- Vault key와 DB key 분리
- Connector Runtime 전용 서비스 계정
- 카드사 도메인 outbound allowlist
- 인증서·임시파일 작업 종료 즉시 삭제
- 운영자 원문 접근 기본 금지
- break-glass 접근은 고객 승인·TTL·감사 필수
- 조직별 RLS/API/Queue/Storage 격리 테스트
- 인증 실패 횟수 제한
- 연결 해제 시 작업 취소와 credential 폐기

## 13. 개발 순서

### Phase 0 — 첫 카드사 조사·POC, 2~4주

- Pilot 고객 카드사 선정
- 법인 관리자 테스트 계정 확보
- 로그인·공동인증서·추가 인증 조사
- 보유카드와 승인내역 조회 가능성 검증
- 카드사 약관·법률 검토
- CSV 90일 데이터 확보

### Phase 1 — 공통 Connector 기반, 3주

- manifest/interface
- 인증 상태 머신
- Credential Broker/Vault adapter
- Queue/lease/heartbeat
- Mock Connector 전환
- PAN redaction

### Phase 2 — 카드 discovery, 2~3주

- 첫 카드사 인증
- 추가 인증
- 보유카드 parser
- token/last4 저장
- 카드 선택·담당자 화면

### Phase 3 — 거래 수집, 4~6주

- 승인·취소·매입 parser
- pagination/cursor
- 90일 백필
- 증분 동기화
- 멱등성·거래 그룹
- 장애 분류와 재인증

### Phase 4 — 대사·운영, 3주

- CSV 대사
- 연결 active gate
- health check/schema 감지
- 운영 콘솔/kill switch
- 연결 해제·폐기

### Phase 5 — Pilot, 2주 이상

- 회사 1~3곳
- 카드 30장 이하
- 매일 CSV 대사
- 자동 결산 확정 비활성
- 중복·누락·오합산 추적

첫 카드사까지 총 16~21주를 기본 계획으로 잡는다. 카드사 인증 난이도와 법률·약관 검토에 따라 늘어날 수 있다.

## 14. 완료 기준

첫 카드사 Connector는 다음을 모두 만족해야 완료다.

1. TimeFit 내부에서 인증과 추가 인증 완료
2. 보유카드 조회와 선택 가능
3. 전체 카드번호·CVC 저장 0건
4. 최근 90일 승인·취소·매입 수집
5. 동일 범위 3회 재수집 후 중복 0건
6. 부분취소 순액 정확
7. 실패 page부터 재개
8. 인증 만료 시 계정 잠금 없이 재인증 전환
9. schema 변경 시 자동 차단
10. 카드사 CSV와 30일 일별 순액 100% 일치
11. 조직 A 인증으로 조직 B 정보 접근 0건
12. 2주 Pilot 중 P0/P1 장애 0건

## 15. 즉시 착수 항목

1. 첫 카드사와 Pilot 고객 확정
2. 해당 카드사의 법인 계정 인증 흐름 조사
3. 공동인증서가 서버 인증 가능한지 로컬 모듈이 필요한지 판정
4. 현재 `cardNo` 식별자 fallback 제거
5. Connector SDK와 manifest 코드 작성
6. Mock 동기화를 Queue 기반으로 전환
7. Vault 제품/운영 방식 결정
8. 실제 CSV fixture와 대사 테스트 작성

개발의 첫 성과물은 화면 mockup이 아니라 첫 카드사의 `인증 → 보유카드 조회` POC다. 이 POC가 통과해야 거래내역 수집 개발 일정을 확정할 수 있다.
