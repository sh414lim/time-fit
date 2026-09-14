# TimeFit 자체 법인카드 Provider 기능 구조 검토

## 1. 검토 결론

현재 TimeFit의 카드 연결·원장 골격을 유지하면서 자체 Provider 계층을 추가하는 방식으로 구현한다. 기존 코드는 연결 상태, 보유카드 선택, 90일 백필, 증분 동기화, 커서, 승인·취소·매입 이벤트, 중복 제거와 지출 원장을 이미 보유하고 있다. 새로 만들어야 할 핵심은 **카드사 접속을 담당하는 Connector Runtime**이다.

목표 사용 흐름은 다음과 같다.

```text
회사 관리자 동의
→ 카드사·인증 방식 선택
→ 카드사 인증
→ 보유 법인카드 자동 발견
→ 수집 카드와 담당 직원 선택
→ 최근 90일 내역 수집
→ 승인·취소·매입 표준화
→ 직원 증빙 요청과 지출 원장 생성
→ 30~60분 증분 동기화
```

자체 Provider 개발은 기술적으로 가능하지만, 첫 Pilot은 `법인공용카드 + 카드사 1곳 + ID/PW 또는 허용된 공동인증서 + CSV 대사`로 제한한다. 모든 카드사를 한 번에 지원하지 않는다.

## 2. 현재 코드 준비도

### 이미 구현된 기능

| 기능 | 현재 구성 | 판단 |
| --- | --- | --- |
| 연결 생성·동의 | `api/card-connections.js` | 재사용 |
| 보유카드 탐색·선택 | `api/card-connection-assets.js` | 재사용 후 권한 보강 |
| 최초/수동 동기화 | `api/card-sync.js` | 작업 enqueue 방식으로 변경 |
| 예약 동기화 | `api/card-sync-worker.js` | scheduler 역할만 유지 |
| 동기화 실행 | `api/_card-sync-runner.js` | queue worker로 분리 |
| Provider factory | `api/providers/card-provider.js` | 자체 Connector registry로 확장 |
| 연결 UI | `CardConnectionWizard.jsx` | 카드사별 동적 인증 UI로 변경 |
| 연결·카드·run·cursor | Supabase migration | 재사용 및 복합 무결성 보강 |
| 승인·취소·매입 이벤트 | immutable event/group 모델 | 재사용 |
| 지출·영수증·결산 | finance 기능군 | 재사용 |

### 현재 상태에서 실제 동기화가 불완전한 이유

- 실제 카드사 Connector가 없다.
- Hyphen endpoint와 인증 payload가 계약 전 placeholder다.
- 자체 카드사 로그인/공동인증서 실행기가 없다.
- 인증정보가 일반 connection row의 암호문으로 보관된다.
- 동기화가 HTTP 요청 안에서 순차 실행되어 장기 백필에 취약하다.
- 카드별 승인/매입/청구가 하나의 `approvals` cursor에 집중되어 있다.
- 조직·카드사별 분산 lock과 세부 호출 제한이 없다.
- 카드 전체번호가 Provider asset ID로 저장될 수 있는 fallback이 있다.
- 실제 카드사 CSV와의 대사 완료 상태가 연결 활성 조건에 포함되지 않는다.

## 3. 목표 시스템 구조

```text
[TimeFit Web]
  동의·카드사 선택·인증·카드 선택·상태
              │
              v
[Connection Control API]
  조직 권한·동의·연결 상태·인증 challenge
              │
              v
[Credential Broker] ───── [Vault/KMS]
  작업 목적·만료·조직 검증       인증서/ID/PW
              │
              v
[Job Orchestrator / Queue]
  discover / backfill / incremental / reauth
              │
              v
[Isolated Connector Runtime]
  Shinhan / Samsung / KB / Hyundai / Hana
              │
              v
[Normalizer + Validator]
  PAN 최소화·schema 검증·공통 이벤트 변환
              │
              v
[Immutable Event Store]
              │
              v
[Transaction Grouper]
  승인 + 전체취소 + 부분취소 + 매입 + 청구
              │
              v
[Expense Ledger]
  담당자·사유·영수증·계정과목·결산
```

Control API와 Connector Runtime을 분리한다. 일반 TimeFit API 서버는 카드사 인증정보 원문을 읽거나 카드사 홈페이지에 직접 접속하지 않는다. Connector Runtime만 작업 시간 동안 Vault에서 필요한 인증정보를 받아 메모리에서 사용한다.

## 4. 기능 모듈

### 4.1 카드 연결·동의

필요 기능:

- 법인공용/법인개별/개인사업자 구분
- 수집 데이터, 목적, 주기, 보존기간, 해제 방법 안내
- 동의 전문 version/hash, 동의자, 시각, IP/device 기록
- 연결 가능한 카드사와 현재 지원 수준 표시
- 카드사별 인증 방식 동적 표시
- 카드사 점검 또는 미지원 상태 표시

연결 상태:

```text
draft
→ consented
→ authentication_pending
→ challenge_required
→ discovering
→ selecting
→ backfilling
→ reconciling
→ active

실패 분기:
reauth_required / degraded / paused / disconnected
```

현재 `authenticating` 하나로 표현하는 인증 단계를 challenge와 discovery로 세분화한다.

### 4.2 인증정보와 추가 인증

지원 후보:

- 카드사 기업 홈페이지 ID/PW
- 법인 공동인증서 또는 카드사 업무용 인증서
- 휴대전화/앱/OTP 추가 인증
- 카드사 공식 OAuth/ERP 연계

원칙:

- CVC와 카드 결제 비밀번호는 수집하지 않는다.
- ID/PW·인증서 원문은 일반 DB에 저장하지 않는다.
- 인증서는 Vault object, connection에는 opaque credential reference만 저장한다.
- 추가 인증 코드는 짧은 TTL의 challenge에만 저장하고 성공 후 즉시 폐기한다.
- 운영자는 인증정보를 조회할 수 없다.
- 인증정보 사용, 교체, 실패, 폐기는 값 없이 감사 로그에 남긴다.

추가 데이터 모델:

```text
card_credentials
- id, organization_id, connection_id
- vault_reference, credential_type, key_version
- status, last_verified_at, expires_at, destroyed_at

card_auth_challenges
- id, organization_id, connection_id
- challenge_type, status, expires_at
- attempt_count, connector_session_reference
```

### 4.3 Connector SDK

모든 카드사는 동일한 내부 계약을 구현한다.

```typescript
interface TimeFitCardConnector {
  manifest(): ConnectorManifest;
  beginAuthentication(input: AuthInput): Promise<AuthStep>;
  continueAuthentication(challenge: ChallengeInput): Promise<AuthStep>;
  discoverCards(session: ConnectorSession): Promise<CardAsset[]>;
  fetchEvents(query: EventQuery): Promise<EventPage>;
  healthCheck(): Promise<ConnectorHealth>;
  logout(session: ConnectorSession): Promise<void>;
}
```

manifest:

- issuer code와 지원 사업자 유형
- 인증 방식과 입력 field schema
- cards/approvals/cancellations/acquisitions/billing capability
- 최대 조회기간, pagination, 권장 호출 간격
- 지원 시간대와 점검시간
- connector/schema version

카드사 구현은 `connectors/{issuer}/{version}` 단위로 격리한다. Connector가 TimeFit DB를 직접 수정하지 않고 표준 응답만 반환하도록 한다.

### 4.4 카드 발견과 등록

카드사 인증 성공 후 보유카드 목록을 가져온다.

저장 가능:

- 카드사 코드
- Provider가 제공하는 안정적 카드 식별자 또는 HMAC token
- 카드 별칭/상품명
- last4
- 법인공용/개별 구분
- 활성/해지/재발급 상태

저장 금지:

- 전체 카드번호
- CVC
- 카드 비밀번호
- 인증서 비밀번호 평문

카드사에서 안정적인 카드 ID 없이 전체 PAN만 반환하면 격리 Runtime에서 `HMAC(조직별 키, issuer + PAN)`을 생성하고 PAN을 즉시 폐기한다. 일반 API에는 token과 last4만 반환한다.

사용자는 발견된 카드 중 자동 수집할 카드만 선택하고 다음을 설정한다.

- 담당 직원
- 담당 부서/매장
- 담당 적용 시작일
- 기본 프로젝트/비용센터
- 증빙 요청 정책

### 4.5 작업 큐와 실행기

작업 유형:

```text
AUTHENTICATE
DISCOVER_CARDS
BACKFILL_APPROVALS
BACKFILL_ACQUISITIONS
INCREMENTAL_APPROVALS
INCREMENTAL_ACQUISITIONS
FETCH_BILLING
RECONCILE
DISCONNECT
```

한 작업은 `연결 × 카드 × 데이터 종류 × 기간 × 페이지` 단위로 작게 나눈다. 90일을 한 HTTP 요청에서 처리하지 않는다.

필요 제어:

- organization/connection/card/job 분산 lock
- 카드사별·계정별 concurrency 제한
- 카드사별 rate limit과 retry budget
- idempotency key
- heartbeat와 lease 만료
- 중단 지점 cursor
- schema mismatch kill switch
- 작업 취소와 재실행

현재 Vercel cron endpoint는 “처리할 연결을 찾아 queue에 넣는 scheduler” 역할만 한다. 실제 카드사 접속은 별도 장기 실행 worker 또는 짧게 분할된 queue consumer가 맡는다.

### 4.6 표준 이벤트와 거래 합성

공통 이벤트:

```text
approval
cancellation
partial_cancellation
acquisition
acquisition_cancellation
billing
payment
```

필수 필드:

- provider event ID 또는 안정적 idempotency key
- 카드 token, 카드사
- 발생 일시와 수신 일시
- 금액, 통화, 해외 원금액
- 승인번호와 원승인 참조
- 가맹점명, 사업자번호, MCC
- 할부 개월, 국내/해외
- source와 connector/schema version

합성 원칙:

- 승인 100,000원과 부분취소 20,000원은 순액 80,000원 한 거래다.
- 전체취소는 순액 0원이며 승인과 취소를 지출 두 건으로 합산하지 않는다.
- 매입은 기존 승인을 확정 상태로 전환한다.
- 승인 없이 매입이 먼저 발견돼도 임시 그룹을 만든 뒤 추후 결합한다.
- 확정 결산 이후 들어온 취소는 기존 결산을 수정하지 않고 조정분을 만든다.

기존 immutable event/group/RPC는 이 계층에 재사용한다. `acquisition_cancellation` 등 실제 카드사 응답에서 필요한 이벤트 유형은 추가 검토한다.

### 4.7 동기화 정책

최초 연결:

- 최근 90일 승인과 매입을 별도로 백필
- 카드사 최대 조회기간에 따라 7~30일 단위 분할
- 카드별 진행률 표시
- 완료 후 CSV와 일별 순액 대사

증분 수집:

- 승인: 30~60분
- 매입: 3~6시간
- 청구: 일 1회 또는 결제일 인접 시
- 취소/지연 매입을 위해 최근 7일 overlap 조회
- 월말에는 이전 30일 보정 조회

연결을 `active`로 만드는 조건:

- 보유카드 discovery 성공
- 선택 카드 90일 또는 가능한 전체 범위 수집 완료
- 중복 제거 완료
- CSV 대사 또는 관리자의 명시적 검증 승인
- 인증정보와 다음 동기화 시각 정상

### 4.8 사용자 화면

#### 연결 마법사

1. 카드사 선택
2. 수집·보관·해제 동의
3. 인증 방식 선택
4. 카드사 인증/추가 인증
5. 발견된 카드 선택
6. 담당 직원 지정
7. 최초 수집 진행률
8. 대사 결과와 연결 완료

#### 카드 관리

- 카드사·별칭·last4·담당자
- 연결 상태와 최근 성공 시각
- 다음 동기화 예정
- 최근 오류와 사용자가 할 일
- 수동 동기화·재인증·일시정지·연결 해제
- 카드 재발급 관계

#### 동기화 상태

- 전체 성공/부분 성공/실패 구분
- 카드별 수집 범위와 건수
- 신규/중복/취소/매입 건수
- API 결과와 CSV 대사 차이
- 기술 오류 코드를 사용자 문장으로 변환

## 5. API 설계 초안

```text
GET    /api/card-connectors
POST   /api/card-connections/consent
POST   /api/card-connections
POST   /api/card-connections/{id}/auth/start
POST   /api/card-connections/{id}/auth/continue
POST   /api/card-connections/{id}/discover
GET    /api/card-connections/{id}/assets
POST   /api/card-connections/{id}/assets/select
POST   /api/card-connections/{id}/sync
GET    /api/card-sync-runs/{runId}
POST   /api/card-connections/{id}/reauth
POST   /api/card-connections/{id}/pause
DELETE /api/card-connections/{id}
POST   /api/card-imports/csv
GET    /api/card-reconciliations/{id}
```

모든 요청은 URL/body의 organization ID만 믿지 않고 다음을 검증한다.

```text
authenticated user
→ organization membership
→ finance permission
→ connection/card/run의 organization
→ 참조 객체 전체의 organization 일치
```

## 6. DB 보완

신규 또는 변경 대상:

- finance role/permission
- consent evidence와 동의 전문 hash
- connector registry/version/capability
- credential reference와 auth challenge
- sync job/lease/heartbeat/page cursor
- source delivery와 raw checksum
- reconciliation batch와 일별 control total
- card assignee history와 적용기간
- connector health와 schema incident

조직 무결성:

- connection, asset, corporate card, cursor, run의 `organization_id` 교차 일치
- 가능하면 복합 unique/FK 사용
- service role API에서도 공통 ownership 검증
- Queue payload, Storage path, cache key에 organization 포함

## 7. 보안·법률 출시 조건

기술 조건:

- 전체 PAN/CVC가 DB, 로그, telemetry, error body에 0건
- credential Vault와 일반 애플리케이션 권한 분리
- Connector Runtime의 외부 접근 allowlist
- 실행 종료 후 세션·임시파일 삭제
- 카드사별 kill switch
- 조직 A/B RLS/API/Queue/Storage 공격 테스트

사업·법률 조건:

- 고객의 위임과 데이터 수집 동의
- 카드사 약관상 자동조회 허용 여부
- 법인공용/법인개별/개인사업자 처리 차이
- 신용정보법상 허가·업무 범위 검토
- 인증정보 보관과 재위탁 구조
- 연결 해제와 회사 탈퇴 시 파기·보존 기준

동의는 데이터 처리 권한의 근거이지 카드사 접근을 기술적으로 허용하는 수단은 아니다. 카드사별 접근 방식에 대한 약관과 기술 검증이 별도로 필요하다.

## 8. 개발 단계

### Sprint 0 — 카드사 1곳 타당성, 2~4주

- Pilot 고객이 실제 사용하는 카드사 선정
- 법인 관리자 계정과 테스트 카드 확보
- 약관·인증 방식·추가 인증·다운로드 조사
- 보유카드/승인/취소/매입 접근 POC
- 실제 CSV 90일 기준 데이터 확보
- 법률 질문과 보안 위협모델

완료 기준: 허용된 절차로 반복 로그인하고 테스트 거래를 조회할 수 있다.

### Sprint 1 — 자체 Provider 공통 기반, 2~3주

- Connector SDK와 manifest
- finance permission과 조직 검증
- Vault adapter/credential broker
- auth challenge 상태 머신
- PAN 비저장 처리
- Queue/job/lease 기본 구조

완료 기준: Mock Connector가 인증→discovery→job→event 전 과정을 새 구조로 통과한다.

### Sprint 2 — 첫 카드사 Connector, 4~8주

- 로그인과 추가 인증
- 카드 discovery
- 승인·취소·매입 parser
- pagination/cursor/rate limit
- 재인증·점검·schema 오류 분류
- connector fixture와 변경 감지

완료 기준: 실제 카드 1~10장의 30일 데이터를 반복 수집한다.

### Sprint 3 — 원장·대사 안정화, 3~4주

- 부분취소·지연 매입 합성
- 90일 백필과 작업 재개
- CSV/XLSX 대사
- 카드별 control total
- 연결 활성화 gate

완료 기준: 30일 일별 순액이 CSV와 100% 일치하고 3회 재수집 시 합계가 변하지 않는다.

### Sprint 4 — 사용자 업무와 운영, 2~3주

- 카드 담당자와 증빙 요청
- 재인증/일시정지/연결해제 UI
- connector health·작업·오류 운영 화면
- 장애 runbook과 kill switch
- 보존·파기 자동화

완료 기준: Pilot 2주 동안 중복·오합산·교차 조직 노출 0건.

첫 카드사 Pilot 총기간은 약 13~22주다. 법률 검토, 카드사 협의, 공동인증서용 장치 프로그램이 필요하면 추가된다.

## 9. 구현 우선순위

### P0

1. Hyphen `cardNo` provider ID fallback 제거
2. finance permission과 교차 조직 자동 테스트
3. Connector SDK와 카드사 capability manifest
4. Vault reference와 auth challenge
5. 동기화를 HTTP 요청에서 queue job으로 분리
6. 첫 카드사 로그인·보유카드 POC

### P1

7. 승인·취소·부분취소·매입 표준화
8. 90일 백필과 카드별 cursor
9. CSV 대사와 active gate
10. 카드 담당자·증빙 요청
11. 재인증·일시정지·연결 해제

### P2

12. 카드사 두 번째 Connector
13. 이메일 승인 알림 보조
14. 청구·한도
15. connector 운영 콘솔과 조직별 원가

## 10. 테스트 시나리오

| ID | 시나리오 | 기대 결과 |
| --- | --- | --- |
| C01 | 조직 A가 조직 B connection ID 조회 | 403, 데이터 노출 없음 |
| C02 | 잘못된 인증정보 | 재인증 상태, 비밀 로그 없음 |
| C03 | 추가 인증 만료 | challenge 폐기, 새 인증 요구 |
| C04 | 카드번호만 제공되는 카드 | HMAC token+last4, PAN 미저장 |
| C05 | 카드 재조회 | 동일 카드 중복 없음 |
| C06 | 동일 승인 3회 수집 | event 1건, 합계 불변 |
| C07 | 100,000 승인 후 20,000 부분취소 | 순액 80,000 |
| C08 | 승인 후 전체취소 | 순액 0 |
| C09 | 매입이 늦게 수집 | 기존 거래 group 갱신 |
| C10 | 5페이지 중 3페이지 실패 | 성공 범위 보존, 3페이지 재개 |
| C11 | 카드사 429 | backoff, 다른 카드 계속 처리 |
| C12 | DOM/schema 변경 | connector 차단과 경보 |
| C13 | CSV 중첩 기간 업로드 | 기존 API 거래와 중복 제외 |
| C14 | 결산 후 취소 | 기존 결산 불변, 조정 생성 |
| C15 | 연결 해제 | 예약 작업 중단, credential 폐기 |

## 11. 최종 권고

TimeFit은 기존 금융 원장 코드를 폐기하지 않고 그 앞에 자체 Provider 플랫폼을 추가한다. 첫 개발 목표를 “카드 등록 화면 완성”으로 잡으면 안 된다. 실제 성공 기준은 **한 카드사에서 인증, 보유카드 discovery, 승인·취소·매입 30일 수집, CSV 대사, 재인증까지 반복 가능**한 것이다.

권장 착수 순서는 다음으로 확정한다.

```text
첫 카드사와 Pilot 계정 선정
→ 약관·인증·데이터 POC
→ 공통 Connector SDK/Vault/Queue
→ 카드 discovery
→ 승인·취소·매입 Connector
→ 90일 백필·CSV 대사
→ 직원 증빙·결산 연결
→ 2주 Pilot
→ 두 번째 카드사 확장
```
