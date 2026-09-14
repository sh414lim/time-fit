# TimeFit 법인카드 기획·설계 재검토 보고서

버전: 1.0

검토일: 2026-09-12

기준 문서: `111-external-card-provider-final-plan-and-architecture.md`

검토 대상: 법인카드 연결 UX, 외부 Provider Adapter, 인증정보, 카드 발견, 동기화, 거래 정규화, 멀티테넌트 권한, 영수증·지출·결산 연결

## 1. 최종 판정

기획 방향은 승인한다. 구현 상태는 `Mock 기반 골격 완료, 운영 Provider 연결 전 보완 필수`로 판정한다.

외부 Provider가 카드사 인증과 원천 내역 수집을 담당하고 TimeFit이 카드 관리, 표준 거래 모델, 영수증 매칭, 지출 원장, 결산을 담당하는 책임 경계는 적절하다. 현재 데이터 모델도 연결→카드→불변 이벤트→거래 그룹→지출 원장으로 이어지는 기본 구조를 갖추고 있다.

그러나 현재 화면과 서버는 실제 Provider의 최초 인증을 완료할 수 없고, 고객 인증정보를 복호화 가능한 암호문으로 일반 DB에 저장하며, 전체 카드번호가 내부 ID로 저장될 수 있다. 동기화도 한 요청 안에서 실행되고 페이지 반복 처리가 없어 운영 카드 데이터를 안전하게 수집하는 수준은 아니다.

따라서 현 상태에서 가능한 것:

- Mock 카드 연결
- Mock 보유카드 발견·선택
- Mock 승인·부분취소·매입 수집
- 중복 이벤트 제거와 거래 그룹 합산
- 재인증 상태와 기본 이력 표시

현 상태에서 불가능하거나 승인할 수 없는 것:

- 실제 CODEF/Hyphen 카드 등록
- 실제 고객 인증서/계정의 안전한 운영 보관
- 대량 90일 백필의 누락 없는 실행
- 계약 Provider의 카드사별 오류·재인증 처리
- 운영 수준의 연결 해제·동의 철회
- 법인카드 기능의 상용 출시

## 2. 제품 정의 재확정

TimeFit의 법인카드 기능은 다음 사용자 약속으로 제한한다.

> 고객사가 TimeFit에서 계약 Provider 인증을 완료하면 보유 법인카드를 선택할 수 있고, 승인·취소·매입 내역이 자동 동기화되어 영수증과 중복 없이 하나의 지출 원장으로 관리된다.

TimeFit은 카드사가 아니며 카드 결제·한도 변경·송금 기능을 제공하지 않는다. `실시간 조회`라는 표현도 사용하지 않고 `자동 동기화`, `최근 동기화 시각`, `데이터 기준 시각`을 사용한다.

### 2.1 1차 제품의 절대 핵심

법인카드 기능의 1차 목표는 카드 등록 화면 자체가 아니라 `실제 카드 내역 조회 및 지속 수집`이다.

```text
Provider 인증 성공
→ 보유카드 조회
→ 과거 승인·취소·매입 내역 수집
→ 이후 변경분 자동수집
→ 중복 제거·원승인 연결
→ 카드사 원본/CSV와 합계 대사
```

P0 필수 기능:

1. 고객사가 실제 법인카드를 인증할 수 있다.
2. 보유카드 목록과 last4를 조회할 수 있다.
3. 최소 90일 승인내역을 빠짐없이 가져온다.
4. 전체취소·부분취소·매입을 원승인과 연결한다.
5. 마지막 성공 이후 변경분을 자동으로 수집한다.
6. 재실행해도 동일 거래가 중복 저장·합산되지 않는다.
7. 페이지 중간 실패 후 실패 지점부터 재개한다.
8. 최근 동기화 시각과 데이터가 수집된 마지막 시각을 구분한다.
9. 인증 만료·카드사 점검·호출 제한을 구분한다.
10. 카드사 CSV와 기간별 건수·순액을 대사할 수 있다.

P0 완료 전 후순위로 두는 기능:

- 카드 디자인과 별칭 고도화
- 담당 직원·부서·프로젝트 자동화
- 영수증 OCR 자동 매칭
- 순익 차트와 결산 보고서
- 한도·포인트·결제예정액
- 지출 승인과 전자결재

후순위 기능을 먼저 개발하더라도 법인카드 MVP 완료율에는 포함하지 않는다.

### 2.2 내역 수집 데이터 범위

| 데이터 | 우선순위 | 사용 목적 |
|---|---:|---|
| 보유카드 목록 | P0 | 수집 대상 카드 선택 |
| 승인내역 | P0 | 사용 직후 잠정 지출 |
| 전체취소 | P0 | 승인 순액 제거 |
| 부분취소 | P0 | 정확한 거래 순액 계산 |
| 매입내역 | P0 | 월 결산 확정 지출 |
| 가맹점·사업자번호 | P0 | 거래 식별·분류·영수증 대조 |
| 승인번호·원승인키 | P0 | 취소 연결·중복 제거 |
| 청구내역 | P1 | 카드 명세 대사 |
| 결제예정액 | P1 | 현금흐름 참고 |
| 이용한도 | P2 | 카드 운영 편의 |

Provider가 승인·취소·매입을 하나의 API로 제공하는지 각각 제공하는지는 계약 명세에 따라 Adapter 내부에서 처리한다. TimeFit 표준 이벤트 모델은 데이터 제공 방식과 관계없이 이 유형을 분리해 저장한다.

### 2.3 수집 성공의 정의

API가 HTTP 200을 반환했다고 동기화 성공으로 판정하지 않는다. 다음을 모두 만족해야 성공이다.

- 요청 기간의 모든 페이지 처리
- 각 페이지 저장과 checksum 검증
- Provider가 알려준 총건수와 저장 건수 일치
- 다음 cursor 또는 기간 종료 확인
- 승인·취소·매입 이벤트 그룹 재계산 완료
- 실패·격리 행 0건 또는 명시적인 `partial` 상태
- 성공한 범위까지만 cursor 전진

수집 상태는 `queued → running → partial/succeeded/failed`로 관리한다. 일부 카드나 페이지가 실패하면 연결 전체를 성공으로 표시하지 않는다.

## 3. 핵심 사용자 흐름 재설계

### 3.1 최초 연결

```text
법인카드 연결
→ 지원 Provider·카드사·사업자 유형 안내
→ 금융정보 수집·이용 동의
→ Provider 인증 세션 생성
→ Provider hosted 인증 또는 안전한 인증정보 전달
→ 인증 완료 callback 확인
→ 보유카드 조회
→ 사용할 카드 선택
→ 담당자·매장·기본 분류 지정
→ 90일 백필 job 생성
→ 진행률·예상 완료시간 표시
→ 카드사 CSV 대사
→ 자동 동기화 활성화
```

최초 연결 화면에 카드사 로그인 ID/PW를 먼저 고정하지 않는다. 인증서, ID/PW, 간편인증 등 방식은 선정 Provider의 capability와 카드사별 schema가 결정한다.

### 3.2 일상 운영

```text
예약 동기화
→ 신규 승인·취소·매입 수집
→ 이벤트 멱등 처리
→ 거래 그룹 순액 갱신
→ 담당 직원에게 증빙 요청
→ 영수증 OCR·자동 후보
→ 정상 건 자동 정리 / 예외만 관리자 검토
```

### 3.3 재인증

```text
인증 오류 분류
→ 자동 재시도 중단
→ 소유자에게 재인증 알림
→ 새 Provider 인증 세션
→ 보유카드 조회로 검증
→ credential reference 원자적 교체
→ 누락 기간 백필
→ 정상 상태 복귀
```

새 인증이 검증되기 전 기존 credential reference를 덮어쓰지 않는다.

### 3.4 일시중지·해제

- 일시중지: 신규 수집만 멈추고 credential과 과거 원장은 유지
- 연결 해제: Provider revoke, credential reference 파기, 예약 작업 취소
- 카드 제외: 해당 카드 수집 중단, 과거 거래·증빙·결산 유지
- 동의 철회: 연결 해제와 동일한 수집 중단 후 법정·계약상 보존기간 정책 적용

## 4. 화면 기획

### 4.1 카드 연결 전

- 주 CTA: `법인카드 연결`
- 보조 CTA: `CSV로 내역 가져오기`
- 지원 카드사와 인증 방식
- 수집 정보: 카드 식별정보, 승인, 취소, 매입
- 저장하지 않는 정보: 전체 카드번호, CVC, 카드 비밀번호
- 예상 동기화 주기와 Provider 장애 가능성
- 개인정보·신용정보 처리방침과 동의 전문

### 4.2 연결 마법사

1. 사업자 유형 선택
2. 카드사/연결 방식 선택
3. 필수 동의
4. Provider 인증
5. 보유카드 선택
6. 담당자·매장·계정과목 설정
7. 최초 동기화 시작

`등록`, `저장`, `연결`, `취소`의 의미를 분리한다.

- `카드 연결`: Provider 인증을 시작
- `선택한 카드 사용`: 발견된 카드를 TimeFit 관리 대상으로 지정
- `설정 저장`: 담당자·매장·분류만 저장
- `연결 해제`: 자동 수집과 인증 관계 종료
- `닫기`: 변경 없이 마법사 종료

### 4.3 연결 완료 카드 목록

카드별 표시 항목:

- 카드사, 카드명, last4
- 담당 직원, 부서, 매장
- 연결 상태
- 최근 성공/시도 시각
- 데이터 기준 시각
- 다음 동기화
- 최근 30일 승인·취소·순액
- 미증빙·검토 필요 건수

카드별 동작:

- 내역 보기
- 담당자·기본 분류 변경
- 지금 동기화
- 수집 일시중지/재개
- 카드 제외

연결 단위 동작:

- 재인증
- 누락 기간 다시 가져오기
- CSV 대사
- 연결 이력
- 연결 해제

## 5. 현재 구현과 기획의 차이

| 영역 | 기획 목표 | 현재 상태 | 판정 |
|---|---|---|---|
| 외부 Provider | CODEF/Hyphen 계약 연동 | Mock + Hyphen placeholder | 차단 |
| 최초 인증 | Provider 세션/동적 schema | 생성 요청에 authentication 미전달 | 차단 |
| Provider 선택 | 서버가 조직·환경별 허용 | 프런트 `VITE_CARD_CONNECTION_PROVIDER` 및 요청값 | 차단 |
| 인증정보 | Provider token/Vault reference | 복호화 가능한 JSON 암호문을 DB 저장 | 차단 |
| 카드 식별 | opaque provider asset ID | `cardNo` fallback 가능 | 차단 |
| 동의 | 전문 hash·목적·보존·철회 | checkbox + version 문자열 | 차단 |
| 카드 발견 | Provider 목록 조회 | 구현 골격 존재 | 조건부 |
| 카드 선택 | 카드·담당자·매장 설정 | 카드 선택만 존재 | 보완 |
| 90일 백필 | Queue 분할·진행률 | HTTP 요청 안에서 즉시 실행 | 차단 |
| pagination | 모든 페이지 수집 | nextCursor 저장만 하고 반복 없음 | 차단 |
| 동기화 종류 | 승인·매입·청구 개별 cursor | approvals 한 종류로 혼합 호출 | 차단 |
| 동시 실행 | lease와 중복 worker 방지 | 시간 bucket idempotency만 존재 | 차단 |
| 권한 | 세분화 finance role | owner/manager 중심 | 보완 |
| 연결 해제 | revoke·파기·보존 | 연결 단위 API/UX 없음 | 차단 |
| 감사 | 연결 전체 lifecycle | 재인증 중심 일부 기록 | 보완 |
| 멱등 이벤트 | Provider 이벤트 unique | 기본 구현됨 | 조건부 |
| 거래 순액 | 승인·취소·매입 그룹 | 기본 구현됨 | 조건부 |
| CSV 폴백 | API와 동일 원장으로 수렴 | 기초 구현 | 보완 |

## 6. 코드·DB 핵심 발견사항

### P0 — 운영 전 반드시 수정

#### P0-1. 고객 인증정보 일반 DB 저장

현재 Hyphen Adapter는 카드사 코드, 사업자번호, 로그인 방식 및 로그인 정보를 JSON으로 직렬화해 AES-GCM 암호문으로 `credential_reference_encrypted`에 저장한다. 애플리케이션 키가 있으면 복호화할 수 있으므로 최신 설계의 Provider token/Vault reference 원칙과 충돌한다.

수정:

- 최우선: Provider hosted 인증 후 반환된 불투명 connection token만 저장
- 불가능할 때: 별도 Vault에 저장하고 DB에는 secret ID만 저장
- 일반 테이블 SELECT 결과에 credential 관련 필드 포함 금지
- service worker만 Vault reference를 해석하도록 권한 분리

#### P0-2. 전체 카드번호가 Provider ID가 될 가능성

현재 카드 정규화가 `cardId → card_id → cardNoMask → cardNo → card_no` 순서로 ID를 선택한다. `cardNo`가 전체 카드번호이면 connection asset과 corporate card에 저장된다.

수정:

- `cardNo`, `card_no`를 provider asset ID 후보에서 제거
- Provider opaque ID가 없으면 카드번호 저장 대신 HMAC token 생성
- normalizer 출력과 DB write 직전에 PAN 패턴 차단
- 로그, fixture, 테스트에 PAN 탐지 검사 추가

#### P0-3. 최초 실제 인증 흐름 부재

프런트의 연결 생성 요청은 provider, businessType, consentVersion만 보내며 authentication을 보내지 않는다. Hyphen Adapter는 인증 필드를 요구하므로 실제 연결은 생성 단계에서 실패한다.

수정:

- `begin-authentication`과 `complete-authentication` API 분리
- Provider hosted URL/세션 ID/callback state 지원
- 카드사별 동적 인증 schema는 서버 capability로 내려줌
- callback state에 organization, user, nonce, expiry 서명

#### P0-4. Provider를 클라이언트가 선택

클라이언트 환경변수와 요청 body가 provider 이름을 결정하며 서버에 Mock Provider도 항상 등록되어 있다. 운영 환경에서 고객이 요청을 변조해 Mock 연결을 생성할 수 있다.

수정:

- 서버의 조직 플랜·환경·feature flag로 허용 Provider 결정
- Production에서 Mock Provider 등록 자체를 차단
- 요청값은 서버 allowlist의 선택 힌트로만 사용

#### P0-5. 동의 증적 부족

현재 서버는 클라이언트가 보낸 version 문자열과 요청 시각만 저장한다. 동의 전문 hash, 처리 목적, 데이터 범위, Provider, 보존기간, 철회가 없다.

수정:

- 서버가 활성 동의 문서를 조회하고 version/hash를 저장
- checkbox별 필수/선택 범위와 동의 전문 snapshot 저장
- Provider, 카드사, 데이터 범위, 보존기간 기록
- 철회 API와 감사 이벤트 추가

### P1 — Pilot 전 수정

#### P1-1. 동기식 백필과 Worker 부재

`POST /card-sync`가 90일 수집을 같은 HTTP 요청에서 수행한다. Vercel 실행시간을 초과하거나 중간 실패 시 사용자 요청과 작업 상태가 함께 불안정해진다.

수정:

- API는 job 생성 후 `202 Accepted + runId` 즉시 반환
- Worker가 카드×기간×페이지 단위 child job 수행
- lease owner, lease expiry, heartbeat, attempt, dead-letter 적용
- UI는 run 진행률을 polling 또는 realtime으로 표시

#### P1-2. 페이지네이션 누락 가능성

현재 Provider 응답의 `nextCursor`를 저장하지만 한 호출 안에서 다음 페이지를 반복하지 않는다. Provider가 페이지 단위 응답을 주면 첫 페이지만 저장한 뒤 기간 전체가 성공한 것으로 표시될 수 있다.

수정:

- `nextCursor`가 없을 때까지 page job 반복
- 페이지 import 성공 후에만 page cursor 전진
- range `succeeded_through`는 전체 페이지 완료 후 전진
- max page와 loop cursor 감지

#### P1-3. 승인·매입·청구 cursor 혼합

현재 sync run과 cursor는 `approvals`만 사용하면서 Provider가 여러 이벤트 유형을 한 endpoint로 반환한다고 가정한다. 실제 Provider가 승인·매입·청구 API를 분리하면 누락된다.

수정:

- capability별 sync plan 생성
- approvals, acquisitions, billing cursor 독립 관리
- Provider가 통합 endpoint를 제공할 때만 내부에서 병합

#### P1-4. 동시 Worker lease 없음

시간 bucket idempotency key는 동일 요청 중복을 줄이지만 두 Worker가 기존 run 조회 후 동시에 생성·실행하는 race와 오래 멈춘 running 작업을 해결하지 못한다.

수정:

- DB atomic claim RPC
- `lease_owner`, `lease_expires_at`, `heartbeat_at`
- 연결/카드/sync type 단위 advisory lock 또는 unique active lease
- stale run 회수 정책

#### P1-5. 금융 테이블 권한 과다

현재 여러 금융 테이블에 manager 역할의 select/insert/update/delete가 일괄 허용된다. 연결 테이블에는 credential 암호문이 포함되고, 원천 이벤트와 결산은 일반 관리자 직접 수정·삭제를 허용하면 안 된다.

수정:

- credential reference는 별도 private schema/table로 분리
- 이벤트·sync·audit는 클라이언트 쓰기 금지
- 소유자, 비용관리자, 카드담당자, 조회자 권한 분리
- 변경은 검증된 RPC/API만 허용

#### P1-6. 조직 일관성 DB 제약 부족

하위 행의 `organization_id`와 참조한 connection/card의 조직이 같은지 단일 FK만으로 보장되지 않는다.

수정:

- `(organization_id, id)` 복합 unique와 복합 FK
- import RPC에서 connection, card, event 조직 재검증
- 조직 A의 ID를 조직 B payload에 넣는 공격 테스트

#### P1-7. 연결 해제 lifecycle 미완성

연결 단위 revoke, credential 파기, queued job 취소, 자산 비활성화, 과거 원장 보존을 원자적으로 수행하는 API와 화면이 없다.

수정:

- `POST /card-connections/:id/disconnect`
- 소유자 재인증 또는 확인 문구
- Provider revoke 성공/실패와 로컬 파기 상태 분리
- sync 중단, 자산 inactive, 과거 원장 보존
- 동의 철회와 감사 로그

### P2 — 상용 운영 품질 보완

- 카드 선택 단계에서 담당자·매장·기본 계정과목 설정
- 지원 카드사·인증 방식 capability 화면
- 카드별 일시중지/재개와 재발급 관계
- 비용 추적의 실제 request count·provider billable unit 반영
- Provider 원문 schema drift 탐지와 fixture 회귀 테스트
- webhook 수신 시 signature, replay, organization mapping 검증
- 연결 이력에 생성·동의·카드발견·선택·동기화·중지·해제 전체 기록
- 알림: 재인증, 24시간 이상 지연, 백필 실패, 신규 카드 발견
- 관리자 지원을 위한 민감정보 없는 운영 콘솔

## 7. 데이터 모델 수정안

### 연결 공개 정보

`card_connections`:

- organization_id
- provider, provider_environment
- provider_tenant_key_hash
- business_type
- status
- consent_record_id
- auth_session_status
- last_attempted_at, last_succeeded_at, data_through_at, next_sync_at
- last_error_code/category, disconnected_at

### 비공개 인증 참조

`private.card_connection_credentials`:

- organization_id, connection_id
- vault_secret_id 또는 provider_connection_token
- credential_type
- expires_at, rotated_at, revoked_at
- fingerprint만 저장하고 secret 값은 저장하지 않음

브라우저와 authenticated role에는 접근 권한을 주지 않는다.

### 동의

`finance_consents`:

- organization_id, connection_id, user_id
- document_version, document_hash
- provider, purposes, data_scopes
- retention_policy_version
- consented_at, withdrawn_at
- client metadata는 최소화해 감사 목적 범위로 저장

### 작업 큐

`card_sync_jobs`:

- organization_id, connection_id, card_id
- sync_type, range_from/to, page_cursor
- status, priority, attempt_count
- lease_owner, lease_expires_at, heartbeat_at
- request_count, billable_count, estimated_cost
- error code/category, next_retry_at

### 카드와 이벤트

- 카드 식별자는 opaque ID 또는 HMAC token
- issuer, product name, last4는 표시 전용
- event unique 범위는 Provider 명세에 따라 connection/product namespace 포함
- raw payload는 기본 비저장 또는 최소화·암호화·짧은 보존기간

## 8. 상태 머신

```text
draft
→ awaiting_consent
→ authenticating
→ discovering_cards
→ selecting_cards
→ backfilling
→ reconciling
→ active

active → degraded → active
active/degraded → reauth_required → authenticating
active/degraded → paused → active
모든 운영 상태 → disconnecting → disconnected
```

추가 원칙:

- `authenticating` 상태에서 장시간 멈추면 만료 처리
- 일부 카드 실패는 연결 전체 실패가 아니라 `degraded`
- `disconnected`는 재사용하지 않고 새 연결 생성
- 상태 변경은 허용된 transition RPC만 사용

## 9. Provider 계약 확정 질문

실제 구현 전에 CODEF/Hyphen 답변으로 다음을 반드시 채운다.

1. 법인카드와 개인사업자 카드 지원 구분
2. 지원 카드사와 카드사별 인증 방식
3. Provider hosted 인증 또는 connection token 제공 여부
4. 공동인증서 파일·비밀번호의 전달·보관 주체
5. 보유카드 opaque ID와 재발급 식별 방식
6. 승인·취소·부분취소·매입·청구 API 분리 여부
7. 원승인-취소 연결키와 고유 이벤트 ID 안정성
8. 조회 가능 과거 기간, 페이지 크기, cursor 규칙
9. 정상응답/무내역응답/오류응답 과금 기준
10. 조직 10/100/1,000개 예상 비용과 최소 약정
11. 호출 제한과 권장 동기화 간격
12. 데이터 재제공·가공·보관·결산·보고서 이용 권리
13. 장애 SLA와 카드사 화면 변경 대응시간
14. 해지·동의 철회 시 credential 파기 방식
15. 테스트베드가 취소·부분취소·매입을 재현하는지

## 10. 수정 개발 순서

### Gate 0 — 계약 전 즉시 수정

1. Production Mock Provider 차단
2. 카드번호 ID fallback 제거와 PAN 탐지 테스트
3. 인증정보 테이블의 클라이언트 접근 차단
4. 최초 인증 API를 begin/complete로 분리
5. 동의 전문·hash·철회 모델 추가

### Gate 1 — Provider 독립 기반

1. capability 기반 Adapter v2
2. 상태 transition RPC
3. 세분화 finance role
4. 조직 복합 FK와 교차 조직 공격 테스트
5. 비동기 Queue/lease Worker
6. pagination과 sync type별 cursor
7. 연결 해제 lifecycle

### Gate 2 — 선정 Provider Sandbox

1. 실제 인증 세션과 callback
2. 카드 discovery
3. 승인·취소·매입 fixture 계약 테스트
4. 90일 백필과 진행률
5. 재인증·rate limit·점검·schema 오류
6. 같은 기간 3회 수집 멱등성 검증

### Gate 3 — Pilot

1. 고객사 1곳, 카드 1~3장
2. Provider와 카드사 CSV 30~90일 대사
3. 취소·부분취소·지연매입 검증
4. 영수증 매칭과 지출 원장 대사
5. 장애→CSV→복구 훈련
6. 호출비용과 관리자 처리시간 측정

## 11. 테스트·출시 게이트

보안:

- DB·Storage·로그·오류·분석도구에 PAN/CVC/비밀번호 0건
- 조직 A 사용자가 조직 B connection/card/event/job 접근 0건
- Mock Provider 운영 생성 0건
- credential reference 클라이언트 조회 0건

정확성:

- 동일 범위 3회 수집 후 건수·합계 불변
- 승인→부분취소→매입 순액 정확
- 페이지 중간 실패 후 누락·중복 없이 재개
- 카드 API와 CSV 일별 순액 100% 일치
- 카드+영수증이 지출 원장 한 건으로 수렴

운영:

- 90일 백필이 HTTP timeout과 독립적으로 완료
- Worker 강제 종료 후 lease 만료·재개 성공
- 인증 오류가 무한 재시도를 만들지 않음
- 연결 해제 후 신규 수집 0건, 과거 원장 유지
- Provider 장애 중 CSV 운영 후 복구 합계 일치
- 최근 동기화·데이터 기준시각·영향 기간 정확히 표시

Pilot 출시 조건:

- 2주 이상 병행 운영
- 오합산 0건
- 중복 지출 0건
- 교차 조직 노출 0건
- P0/P1 장애 0건
- 호출비용이 승인된 고객 플랜 원가 범위 내

## 12. 최종 결론

법인카드 기획의 제품 방향과 도메인 모델은 유지할 수 있다. 재설계가 필요한 중심은 `인증정보`, `실제 인증 흐름`, `비동기 수집`, `Provider 페이지·종류별 cursor`, `권한`, `연결 해제`다.

다음 개발의 첫 작업은 Provider endpoint를 임의로 연결하는 것이 아니다. 카드번호 fallback과 인증정보 노출 가능성을 먼저 제거하고, Provider-neutral 인증 세션과 Queue 기반 수집 경계를 완성해야 한다. 이후 계약 명세를 Adapter에 구현하면 현재 지출·증빙·결산 구조를 그대로 재사용할 수 있다.

현재 판정:

```text
기획 방향        승인
Mock 개발 골격   사용 가능
실제 카드 등록   미완료
Pilot 투입       P0/P1 수정 후 가능
상용 출시        Provider 계약·2주 대사 후 가능
```
