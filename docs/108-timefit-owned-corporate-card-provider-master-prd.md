# TimeFit 자체 법인카드 Provider 전체 기획 정의서

## 1. 문서 목적

이 문서는 TimeFit 자체 법인카드 Provider 기능의 제품·업무·기술·보안·운영·출시 기준을 정의하는 단일 기준 문서다. 카드 연결 화면, 카드사별 인증 Connector, 보유카드 등록, 승인·취소·매입 동기화, 직원 증빙, 결산까지 전체 범위를 다룬다.

최종 목표는 여러 회사가 TimeFit 안에서 법인카드를 연결하고 카드 사용내역을 자동으로 가져와 직원·영수증·계정과목·프로젝트·결산과 연결하는 것이다.

## 2. 제품 정의

### 2.1 한 문장 정의

> 고객 회사가 TimeFit에서 카드정보 수집에 동의하고 공동인증서 또는 카드사 기업 계정으로 인증하면, TimeFit 자체 Connector가 보유 법인카드와 거래내역을 수집해 회사별 지출 원장으로 자동 변환하는 기능이다.

### 2.2 핵심 가치

- 여러 카드사 이용내역을 TimeFit에서 통합한다.
- 카드별 실제 사용자·부서·매장을 지정한다.
- 카드 승인 직후 담당 직원에게 증빙을 요청한다.
- 승인·취소·부분취소·매입을 하나의 정확한 지출로 계산한다.
- 근태·급여·매출·지출을 회사별로 연결한다.
- 관리자는 정상 거래가 아니라 미증빙·금액차이·수집실패 같은 예외만 처리한다.

### 2.3 제품 원칙

1. 모든 사용자 과정은 TimeFit 플랫폼 안에서 진행한다.
2. 외부 Provider에 종속되지 않는 자체 Connector 구조를 사용한다.
3. 카드사별 구현은 교체 가능한 독립 모듈로 분리한다.
4. 전체 카드번호·CVC·카드 결제 비밀번호는 저장하지 않는다.
5. 카드 거래 원본 이벤트는 수정하지 않고 후속 이벤트로 상태를 계산한다.
6. 자동화보다 정확성과 대사를 우선한다.
7. 고객 행동이 필요한 오류만 알리고 기술 오류는 운영 계층에서 처리한다.
8. 조직 간 데이터 격리 실패는 출시 차단 사유다.

## 3. 목표와 비목표

### 3.1 목표

- 법인 공동인증서 또는 기업 ID/PW를 이용한 카드사 인증
- 필요 시 SMS·앱·OTP 추가 인증
- 보유 법인카드 자동 발견
- 자동 수집할 카드 선택
- 카드 담당 직원·부서·매장 지정
- 최근 90일 승인·취소·부분취소·매입 수집
- 승인 30~60분, 매입 3~6시간 주기 증분 동기화
- 거래 중복 제거와 승인·취소·매입 결합
- CSV/XLSX 대사
- 직원 사유·프로젝트·태그·영수증 제출
- 관리자 예외 검토와 월 결산·보고서
- 재인증·일시정지·연결 해제

### 3.2 1차 Pilot 비목표

- 모든 카드사 동시 지원
- 개인 소비자 카드
- 카드 발급·정지·한도 변경
- 카드 결제·송금
- CVC·결제 비밀번호 수집
- CAPTCHA 또는 카드사 보안 우회
- AI의 세무 적격성 최종 확정
- 외부 고객에게 금융 API 판매

## 4. 대상 고객과 출시 범위

### 4.1 첫 고객군

- 여러 직원·매장을 운영하는 법인사업자
- 법인공용카드 지출 증빙을 수기로 관리하는 회사
- 카드 사용 후 영수증과 사유 취합에 시간이 많이 드는 회사

### 4.2 Pilot 범위

- 회사 1~3곳
- 카드사 1곳
- 카드 30장 이하
- 법인공용카드 우선
- 실제 거래 30일 이상, 백필 최대 90일
- 자동 결산 확정 비활성
- CSV 일일 또는 주간 대사

### 4.3 확장 순서

```text
카드사 1곳·법인공용카드
→ 카드사 2~3곳
→ 법인개별카드
→ 개인사업자 카드
→ 청구·한도
→ 카드사 공식 ERP/EDI 병행
```

## 5. 사용자와 권한

| 역할 | 연결 | 카드 선택 | 거래 제출 | 거래 검토 | 결산 | 보고서 |
| --- | --- | --- | --- | --- | --- | --- |
| 회사 소유자 | 생성·재인증·해제 | 가능 | 가능 | 가능 | 확정·재오픈 | 전체 |
| 비용관리자 | 운영·일시정지 | 가능 | 가능 | 전체 | 준비 | 전체 |
| 카드 담당자 | 불가 | 불가 | 본인 거래 | 본인 제출 확인 | 불가 | 본인 범위 |
| 일반 직원 | 불가 | 불가 | 요청받은 거래 | 불가 | 불가 | 불가 |
| 조회자 | 불가 | 불가 | 불가 | 불가 | 불가 | 허용 범위 |
| TimeFit 운영자 | 상태만 | 불가 | 불가 | 원문 기본 불가 | 불가 | 익명 지표 |

권한 이름:

```text
finance.connection.manage
finance.card.assign
finance.expense.submit
finance.expense.review
finance.report.read
finance.closeout.manage
finance.support.break_glass
```

## 6. 전체 사용자 여정

```text
TimeFit 로그인
→ 금융정보 처리 동의
→ 사업자·카드사 선택
→ 공동인증서/기업 계정 인증
→ 추가 인증
→ 보유카드 조회
→ 카드 선택·담당자 지정
→ 90일 최초 수집
→ CSV 대사
→ 자동 동기화 정상
→ 직원 증빙 제출
→ 관리자 예외 검토
→ 월 결산·보고서
```

## 7. 화면 정의

### 7.1 금융 연동 홈

표시:

- 연결된 카드사 수
- 활성 카드 수
- 마지막 성공 동기화
- 재인증 필요·수집지연·대사차이 수
- `카드사 연결` 버튼

### 7.2 카드사 선택

카드사별:

- 카드사명과 상태
- 지원 사업자 유형
- 지원 인증 방식
- 지원 데이터: 카드·승인·취소·매입·청구·한도
- 예상 동기화 주기
- Pilot 또는 제한사항

### 7.3 동의

- 수집 정보
- 처리 목적
- 수집 주기
- 보존기간
- 인증정보 처리 방식
- 재위탁 여부
- 해제·파기 방법
- 필수/선택 동의 분리

저장:

- 동의 전문 version/hash
- 동의자와 역할
- 동의 시각
- 조직과 연결 ID
- 선택 범위

### 7.4 인증

공동인증서:

- 인증서 선택
- 발급기관·소유자·만료일 확인
- 비밀번호 입력
- 만료·사업자 불일치 안내

기업 계정:

- 카드사 기업 ID
- 비밀번호
- 필요 추가 필드

추가 인증:

- SMS OTP
- 카드사 앱 승인
- ARS
- 제한시간과 재요청

### 7.5 카드 선택·담당자 지정

- 카드사·상품명·last4
- 법인공용/개별
- 활성·해지·재발급·신규 발견
- 담당 직원·부서·매장
- 적용 시작일
- 증빙 요청 여부
- 전체 선택·검색·일괄 지정

### 7.6 최초 수집

- 전체·카드별 진행률
- 수집 기간
- 승인·취소·매입 건수
- 신규·중복·실패 건수
- 실패 카드 재시도
- 화면을 닫아도 계속 처리됨을 표시

### 7.7 연결 관리

- 연결 상태
- 인증 만료 상태
- 카드별 최근 성공 시각
- 다음 동기화 예정
- 마지막 대사
- 지금 동기화
- 재인증
- 일시정지
- 연결 해제
- 변경 이력

## 8. 연결 상태 정의

```text
draft
→ consented
→ authentication_pending
→ challenge_required
→ authenticated
→ discovering
→ selecting
→ backfilling
→ reconciling
→ active
```

예외 상태:

| 상태 | 의미 | 사용자 조치 |
| --- | --- | --- |
| reauth_required | 인증 만료·변경 | 재인증 |
| degraded | 일부 카드·기간 실패 | 필요 시 재시도 |
| maintenance | 카드사 점검 | 없음 |
| paused | 관리자 또는 안전장치 정지 | 재개 |
| schema_changed | 카드사 화면·응답 변경 | 운영 복구 대기 |
| disconnected | 연결 해제 | 재연결 |

## 9. 기술 구조

```text
[TimeFit Web]
       │
[Connection Control API]
       │
[Authentication Orchestrator]
       ├── [Challenge Store]
       └── [Credential Broker] ── [Vault/KMS]
       │
[Scheduler / Job Queue]
       │
[Isolated Connector Runtime]
       │
[Validator / Normalizer]
       │
[Immutable Card Event Store]
       │
[Transaction Grouper]
       │
[Expense Ledger]
       │
[Receipt / Review / Closeout]
```

### 9.1 Control Plane

- 사용자·조직·권한 확인
- 동의와 연결 상태
- 카드 선택과 담당자
- 동기화 요청과 상태
- 운영 정책과 Connector version

카드사에 직접 로그인하지 않는다.

### 9.2 Credential Plane

- 인증서·ID/PW 암호화 보관
- Connector job 단위 단기 제공
- key rotation
- 접근·교체·폐기 감사

일반 업무 DB에는 opaque Vault reference만 저장한다.

### 9.3 Connector Data Plane

- 카드사 로그인
- 추가 인증 세션
- 보유카드 조회
- 승인·취소·매입 조회
- 카드사별 페이지·호출제한
- 오류와 schema 변경 탐지

작업별 격리 Runtime을 사용하고 종료 시 세션과 임시파일을 삭제한다.

### 9.4 Ledger Plane

- 표준 이벤트 검증
- 멱등성
- 승인·취소·매입 그룹
- 지출 원장
- 영수증 매칭
- 결산 snapshot과 조정분

## 10. Connector 규격

```typescript
interface CardIssuerConnector {
  manifest(): ConnectorManifest;
  beginAuth(input: BeginAuthInput): Promise<AuthStep>;
  continueAuth(input: ChallengeInput): Promise<AuthStep>;
  discoverCards(session: SessionRef): Promise<CardAssetPage>;
  fetchApprovals(query: EventQuery): Promise<EventPage>;
  fetchAcquisitions(query: EventQuery): Promise<EventPage>;
  fetchBilling?(query: EventQuery): Promise<EventPage>;
  logout(session: SessionRef): Promise<void>;
  healthCheck(): Promise<HealthResult>;
}
```

Manifest 필수 항목:

- issuer code
- connector/schema version
- 사업자 유형
- 인증 방식과 입력 schema
- 지원 데이터 capability
- 최대 조회기간
- 최소 호출 간격
- 점검시간
- Pilot/active/degraded/disabled 상태

Connector는 TimeFit DB를 직접 수정하지 않고 표준 결과만 반환한다.

## 11. 인증 설계

### 11.1 공동인증서

지원 방식:

1. TimeFit 화면에서 인증서 파일 선택
2. TimeFit 로컬 인증서 모듈
3. 카드사 공식 전자서명/OAuth 방식

브라우저만으로 PC 인증서 저장소를 자유롭게 검색할 수 없으므로 첫 카드사 POC에서 파일 방식 또는 로컬 모듈 필요 여부를 판단한다.

### 11.2 추가 인증 상태

```text
Connector가 추가 인증 감지
→ challenge ID·TTL 생성
→ TimeFit modal 표시
→ OTP 입력 또는 앱 승인
→ 기존 session 계속 실행
→ 성공·만료 후 challenge 폐기
```

### 11.3 인증 실패

- 잘못된 비밀번호: 제한 횟수 후 중단
- 인증서 만료: 재인증 요청
- 사업자 불일치: 연결 거부
- 계정 잠금: 자동 재시도 중단
- CAPTCHA: 우회하지 않고 사용자 조치 또는 미지원
- 카드사 점검: 종료 이후 예약

## 12. 카드 자산 모델

저장 필드:

```text
organization_id
connection_id
issuer_code
provider_asset_token
display_name
last4
card_type
status
reissued_from
discovered_at
```

식별 우선순위:

1. 카드사가 제공한 비민감 고유 ID
2. 마스킹 카드번호 기반 안정 ID
3. 격리 Runtime에서 생성한 조직별 keyed HMAC

전체 PAN은 Runtime 밖으로 내보내지 않는다. last4가 같다는 이유로 카드를 병합하지 않는다.

## 13. 표준 거래 이벤트

이벤트 종류:

```text
approval
cancellation
partial_cancellation
acquisition
acquisition_cancellation
billing
```

필수/권장 필드:

- provider event ID/idempotency key
- card token과 issuer
- event type
- 발생·수신 시각
- 금액·통화·해외 원금액
- 승인번호·원승인 참조
- 가맹점명·사업자번호·MCC
- 할부개월
- connector/schema version

## 14. 거래 계산 규칙

### 전체취소

```text
승인 100,000 + 취소 100,000 = 순액 0
```

### 부분취소

```text
승인 100,000 + 부분취소 20,000 = 순액 80,000
```

### 매입

- 승인과 매입을 같은 거래 그룹으로 연결한다.
- 최종 회계 금액은 회사 정책에 따라 매입 금액을 우선한다.
- 승인 없이 매입이 발견되면 임시 그룹과 검토 예외를 만든다.

### 해외 결제

- 승인 시 외화·예상 KRW를 보존한다.
- 매입 시 최종 환율·수수료·KRW 금액으로 갱신한다.
- 승인 대비 차이를 이력으로 표시한다.

### 결산 이후 변경

- 확정 snapshot을 조용히 수정하지 않는다.
- 다음 기간 조정분 또는 권한 있는 재오픈으로 처리한다.

## 15. 동기화 엔진

### 15.1 작업 단위

```text
organization
× connection
× card
× event type
× date range
× page/cursor
```

### 15.2 작업 상태

```text
queued → leased → running → succeeded
                 ├→ retry_scheduled
                 ├→ challenge_required
                 ├→ partial
                 ├→ failed
                 └→ dead_letter
```

### 15.3 수집 주기

| 데이터 | 주기 | 중첩 재조회 |
| --- | --- | --- |
| 승인·취소 | 30~60분 | 최근 7일 |
| 매입·매입취소 | 3~6시간 | 최근 14일 |
| 카드 목록 | 일 1회 | 전체 |
| 청구 | 일 1회 | 당월·직전월 |
| 월말 보정 | 일 1회 | 최근 30일 |

### 15.4 복구

- 페이지 성공마다 cursor 기록
- 실패 페이지부터 재개
- heartbeat/lease 만료 작업 회수
- 카드사·계정별 concurrency 제한
- Retry-After 또는 지수 backoff
- schema 변경 시 kill switch

## 16. CSV 대사

연결 활성화 조건으로 사용한다.

비교 항목:

- 카드별·일별 승인 건수와 금액
- 전체취소·부분취소 건수와 금액
- 매입 건수와 금액
- 순액
- 누락·중복·미결합 거래

대사 상태:

```text
not_started
→ parsing
→ comparing
→ matched
또는 review_required
```

Pilot에서는 30일 이상 일별 순액 100% 일치를 요구한다.

## 17. 직원 지출 업무

신규 거래 수집 후:

1. 카드 담당자를 찾는다.
2. 직원 요청함에 거래를 표시한다.
3. 사유·프로젝트·태그·영수증을 제출한다.
4. OCR 결과와 거래를 비교한다.
5. 고신뢰 건은 추천하고 정책상 허용된 경우 자동 연결한다.
6. 미증빙·금액차이·중복의심은 예외함으로 보낸다.

직원은 카드사 원본 금액·승인일시·가맹점을 수정할 수 없다.

## 18. 오류와 사용자 안내

| 분류 | 시스템 처리 | 사용자 메시지 |
| --- | --- | --- |
| authentication | 자동 재시도 중단 | 재인증 필요 |
| challenge | session 유지 | 추가 인증 요청 |
| maintenance | 점검 종료 후 예약 | 카드사 점검 중 |
| rate_limit | backoff | 자동 재시도 예정 |
| network | 제한 재시도 | 일시 지연 |
| partial | 성공 cursor 유지 | 일부 카드 지연 |
| schema_changed | Connector 차단 | 안전 확인 중 |
| invalid_request | 작업 중단 | 입력·연결 확인 필요 |

빈 카드·거래 배열이 schema 변경 때문에 발생했는지 확인하지 않고 정상 처리해서는 안 된다.

## 19. 알림

- 추가 인증: 연결 관리자에게 즉시
- 재인증: 소유자·비용관리자, 하루 1회 최대 3회
- 신규 카드: 비용관리자 1회
- 증빙 요청: 카드 담당자, 회사 정책에 따라 반복
- 카드사 점검: 상태만 표시하고 반복 알림 금지
- 대사 차이: 비용관리자에게 실행마다 알림
- schema 변경: TimeFit 운영자 긴급 경보

## 20. 보안 요구사항

- PAN·CVC·결제 비밀번호 DB/로그/analytics 저장 금지
- 인증정보는 Vault reference만 업무 DB에 저장
- 조직별 RLS·API·Queue·Storage·cache 격리
- Connector Runtime 외부 접근 allowlist
- 인증서·session·임시파일 종료 즉시 삭제
- credential 사용·교체·폐기 감사
- 인증 실패 횟수 제한
- 운영자 원문 접근 기본 차단
- break-glass는 고객 승인·TTL·감사 필수
- 연결 해제 시 queued/running 작업 취소와 credential 폐기

## 21. 법률·계약 검토

첫 카드사 개발 전 서면 확인:

- 고객 위임을 통한 자동조회가 카드사 약관상 가능한지
- 법인공용과 법인개별카드의 처리 차이
- 개인사업자 확장 시 개인신용정보 영향
- 신용정보업·본인신용정보관리업 등 해당 여부
- 공동인증서와 카드사 계정정보 보관 범위
- 고객 데이터 처리위탁·제3자 제공 구조
- 카드사별 사전 제휴 또는 접근 승인 필요 여부
- 보존·파기·연결 해제 정책

사용자 동의는 필수지만 동의만으로 카드사에 대한 기술적·계약상 접근이 자동 허용되지는 않는다.

## 22. 운영 콘솔

표시:

- 카드사별 Connector version·상태
- 1시간/24시간 성공률
- 오류 분류별 비율
- Queue 지연과 고착 작업
- 카드사별 호출량과 원가
- health check
- incident와 kill switch
- 배포 Git commit

표시 금지:

- 인증정보
- 전체 카드번호
- 고객 거래·가맹점 원문
- 영수증 원문

## 23. 핵심 사용 시나리오

### 정상

- 회사 소유자가 공동인증서로 첫 카드사를 연결한다.
- 보유카드를 선택하고 담당 직원을 지정한다.
- 90일 수집과 CSV 대사를 완료한다.
- 정기 수집 후 직원이 증빙을 제출한다.

### 인증

- 인증서 비밀번호 오류는 로그 없이 종료한다.
- 인증서 만료는 재인증으로 전환한다.
- 앱/OTP 인증은 challenge session을 유지한다.
- 반복 실패 시 계정 잠금을 막기 위해 자동 중단한다.

### 카드

- 신규 카드 발견은 관리자 확인 전 자동 수집하지 않는다.
- 재발급 카드는 이전 카드와 관계를 남긴다.
- 같은 last4의 서로 다른 카드를 병합하지 않는다.
- 해지 카드의 과거 거래는 유지한다.

### 거래

- 전체취소 순액은 0원이다.
- 부분취소는 승인에서 취소액을 차감한다.
- 지연 매입은 기존 거래 그룹에 연결한다.
- 결산 후 취소는 조정분으로 처리한다.

### 장애

- 카드사 점검은 자동 예약한다.
- 429는 카드사별 backoff를 적용한다.
- 일부 페이지 실패는 실패 지점부터 재개한다.
- schema 변경은 즉시 Connector를 차단한다.
- Worker 중단은 lease 회수 후 재개한다.

### 보안

- 조직 A가 조직 B connection ID를 사용하면 403이다.
- 오류에도 secret/PAN을 로그에 남기지 않는다.
- 연결 해제 후 신규 카드사 호출이 없어야 한다.

세부 단계·완료 기준은 `107-owned-card-provider-final-review-and-user-scenarios.md`를 따른다.

## 24. 개발 순서와 일정

| Phase | 범위 | 예상 |
| --- | --- | ---: |
| 0 | 첫 카드사·실계정·약관·인증 POC | 2~4주 |
| 1 | finance 권한·조직 격리·PAN 제거 | 2주 |
| 2 | Vault·Credential Broker·인증 상태 | 2~3주 |
| 3 | Connector SDK·Manifest·Mock 전환 | 2주 |
| 4 | Queue·Worker·lease·cursor | 2~3주 |
| 5 | 첫 카드사 인증·보유카드 | 2~3주 |
| 6 | 승인·취소·매입 Connector | 4~6주 |
| 7 | 90일 백필·CSV 대사 | 3주 |
| 8 | 직원 증빙·운영 콘솔 | 2~3주 |
| 9 | Closed Beta | 2주 이상 |

병렬화 시 첫 카드사 Pilot은 약 16~21주, 순차 개발은 약 21~29주로 예상한다. 카드사 협의와 법률 검토 대기는 별도다.

## 25. 출시 게이트

### Gate 0 — 착수

- 카드사와 Pilot 회사 확정
- 테스트 계정·카드·CSV 확보

### Gate 1 — 인증 POC

- TimeFit 내부 인증 성공
- 보유카드 discovery
- 자동화 약관·기술 가능성 확인

### Gate 2 — 보안 기반

- PAN·secret 비저장
- 회사 간 RLS/API/Queue/Storage 테스트 통과
- Vault와 key rotation

### Gate 3 — 데이터 정확성

- 90일 백필
- 동일 범위 3회 재수집 합계 불변
- CSV 30일 일별 순액 100%

### Gate 4 — Beta

- 재인증·점검·429·schema 변경·연결 해제 검증
- P0/P1 결함 0건

### Gate 5 — 출시

- 2주 Pilot 오합산·중복·교차 조직 노출 0건
- 운영·법률·보존정책 승인
- Git main과 production 배포 commit 일치

## 26. 성공 지표

제품:

- 연결 시작 대비 인증 완료율
- 인증 대비 카드 discovery 성공률
- 90일 백필 완료시간
- 거래 수집부터 직원 노출까지의 시간
- 3일 내 증빙 완료율
- 관리자 수동 처리 비율
- 월 결산 소요시간

기술:

- 동기화 성공률 99% 이상
- 승인 반영 P95 60분 이하
- 중복 합산 0%
- CSV 대사 차이 0%
- PAN/secret 로그 탐지 0건
- 교차 조직 노출 0건
- schema 오류로 인한 데이터 삭제 0건

## 27. 현재 TimeFit 코드 적용

재사용:

- card connection·asset·sync run·cursor
- immutable event·transaction group
- expense·receipt·review·closeout·report
- 연결 Wizard와 상태 화면

변경:

- Hyphen 중심 factory를 자체 Connector registry로 전환
- `cardNo` provider ID fallback 제거
- manager 중심 권한을 finance permission으로 분리
- connection row의 encrypted credential을 Vault reference로 이전
- 동기화를 HTTP 요청 내부 실행에서 Queue Worker로 분리
- approvals 단일 cursor를 데이터 종류별 cursor로 확장
- CSV 대사를 active 상태의 조건으로 추가

신규:

- connector definition/version
- credential broker와 auth challenge
- job lease/heartbeat/page 작업
- 카드 담당자 적용 이력
- reconciliation batch/control total
- connector health/incident/kill switch

## 28. 즉시 착수 백로그

### P0

1. 첫 카드사와 Pilot 법인 확정
2. 카드사 인증·보유카드 POC
3. 전체 카드번호 fallback 제거
4. finance permission과 조직 격리 테스트
5. Connector SDK·Manifest
6. Vault·Credential Broker
7. Queue·Worker·lease

### P1

8. 첫 카드사 카드 discovery
9. 승인·취소·부분취소·매입 parser
10. 90일 백필과 cursor
11. CSV 대사
12. 재인증·점검·schema 변경
13. 직원 증빙·예외함 연결

### P2

14. 운영 콘솔
15. 두 번째 카드사
16. 청구·한도
17. 이메일 승인 알림

## 29. 개발 완료 정의

각 기능은 다음을 모두 충족해야 완료다.

1. 사용자·실패·보안 시나리오 구현
2. 역할과 조직 경계 테스트
3. unit/API/RLS/E2E 테스트
4. 민감정보 로그 검사
5. 장애 metric과 감사 이벤트
6. feature flag 또는 rollback 방법
7. `npm test`와 production build 통과
8. Git commit 후 main push
9. Git 기반 production 배포
10. production commit·smoke test 확인

## 30. 최종 의사결정

TimeFit 자체 카드 Provider 개발은 진행 가능하다. 첫 성공 단위는 다음으로 고정한다.

```text
카드사 1곳
× Pilot 법인 1곳
× 실제 카드 1~10장
× TimeFit 내부 인증
× 보유카드 discovery
× 승인·취소·매입 30일 이상
× CSV 일별 순액 100%
× 재인증·연결 해제
```

이 단위가 통과하기 전에는 카드사를 추가하지 않는다. 첫 카드사 POC에서 합법적·안정적인 자동 인증이 불가능하면 해당 카드사는 자체 Connector 대상에서 제외하고 공식 ERP/EDI 또는 CSV 방식으로 전환한다.
