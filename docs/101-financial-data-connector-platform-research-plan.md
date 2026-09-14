# TimeFit 금융 데이터 커넥터 플랫폼 상세 기획 조사

## 1. 결론 요약

TimeFit이 구축해야 할 대상은 하이픈 전체 API 마켓의 복제품이 아니라, 여러 회사가 각자 정당하게 보유한 법인카드 데이터를 연결해 지출 원장으로 변환하는 멀티테넌트 비용관리 SaaS다. 첫 제품 범위는 `회사 가입 → 법인카드 인증 → 보유카드 발견 → 카드 선택 → 승인·취소·매입 수집 → 표준화 → 중복 제거 → 담당자·사유·계정과목 연결`로 제한한다.

하이픈은 법인카드 조회를 스크래핑 기반 API 상품으로 제공하고, 보유카드·승인·매입·결제예정·카드번호·한도 조회를 분리된 기능으로 구성한다.^1 또한 고객 서버에서 호출하는 API형과 고객 장치 또는 별도 엔진에서 실행하는 Local/Server Scraping형을 함께 제공한다.^2 공개 자료만으로 카드사별 내부 구현을 확인할 수는 없지만, 상품 구조상 카드사별 인증 어댑터, 수집 실행기, 표준화 계층, API 게이트웨이, 사용량·과금, 테스트베드와 운영 관제 계층이 필요하다는 점은 합리적으로 추론할 수 있다.

TimeFit의 1차 목표는 외부 판매용 API 마켓도 자체 스크래핑 회사도 아니다. 그랜터와 같이 여러 회사가 회사별로 카드·사용자·지출을 분리해 관리하는 제품이 목표다. 내역 수집은 하이픈 같은 전문 Provider를 우선 사용하고, TimeFit은 Provider를 교체할 수 있는 연결 계층과 지출 업무 기능에 집중한다. 첫 Pilot은 특정 고객사 한 곳과 카드사 한 곳으로 시작하지만 데이터 모델과 권한은 처음부터 다중 회사 기준으로 설계한다. 전체 카드번호와 CVC는 저장하지 않고, 카드사 자격정보는 가능한 한 Provider가 직접 처리하게 한다.

## 2. 제품 목표와 비목표

### 2.1 제품 목표

- 사업장 소유자가 카드사 계정을 한 번 인증하면 보유 법인카드를 자동으로 발견한다.
- 사용자가 선택한 카드만 승인·취소·부분취소·매입·청구 데이터를 수집한다.
- 카드사마다 다른 응답을 TimeFit 공통 이벤트 모델로 변환한다.
- 같은 거래를 여러 번 수집해도 합계가 변하지 않는다.
- 인증 만료, 카드사 점검, 화면 변경, 호출 제한을 자동 분류하고 복구한다.
- 카드 거래와 영수증을 연결해 최종 지출 원장 한 건으로 수렴시킨다.
- 누가 언제 어떤 자격정보를 사용했는지 비밀값 없이 감사 가능하게 한다.

### 2.2 1차 비목표

- 개인 소비자용 통합 자산관리 서비스
- 외부 기업에 API를 판매하는 공개 API 마켓
- 카드 결제 승인·취소·송금 등 자금 이동
- 전체 카드번호 저장 또는 카드번호 조회 상품
- 모든 카드사 동시 지원
- 세금 신고 적격성 자동 판정
- 카드사 약관을 우회하는 브라우저 자동화

### 2.3 목표 제품 형태 — 그랜터형 멀티테넌트 SaaS

그랜터 공개 안내에 따르면 공동인증서 로그인 한 번으로 법인카드가 자산 목록에 자동 추가되고, 이후 결제 내역의 계정과목·사유·태그를 자동화하며 카드 담당자를 연결한다.^9 카드 분석 화면은 여러 법인카드를 카드사별로 모아 번호 뒷자리, 누적 지출, 상태와 사용자 프로필을 보여준다.^10

TimeFit의 목표 기능도 다음처럼 정의한다.

- 여러 회사가 같은 TimeFit 서비스를 사용한다.
- 각 회사 데이터와 자격정보는 논리적·암호학적으로 격리한다.
- 한 회사가 여러 카드사와 여러 법인카드를 연결한다.
- 카드별 실사용 직원 또는 부서·매장을 지정한다.
- 카드 사용내역을 자동 수집한다.
- 직원은 결제 직후 사유·프로젝트·영수증을 제출한다.
- 관리자는 예외 건만 검토한다.
- 회사별 지출·인건비·매출을 결합해 손익을 확인한다.

제품이 외부 회사에 제공되는 SaaS라는 점과 외부 개발자에게 금융 조회 API를 재판매한다는 것은 서로 다른 범위다. 1차는 전자이고, 후자는 별도 법률·보안·사업 승인을 거치는 장기 확장으로 둔다.

### 2.3.1 내역 수집 전략 — Partner First

TimeFit의 경쟁력은 카드사 로그인 자동화 자체가 아니라 근태·직원·영수증·법인카드·매출을 한 조직 안에서 연결하는 데 있다. 따라서 우선순위는 다음과 같다.

1. 카드사 공식 기업 API 또는 제휴 API
2. 하이픈 등 전문 금융 데이터 Provider
3. 카드사 CSV·이메일 전표 폴백
4. 위 방식으로 지원할 수 없는 기관만 자체 Connector 타당성 검토

Provider 종속을 막기 위해 `authenticate`, `listCards`, `fetchEvents`, `disconnect`의 내부 표준 인터페이스를 유지한다. 고객사와 지출 원장 데이터는 TimeFit에 귀속시키되, Provider 고유 필드와 자격정보는 격리한다.

### 2.4 멀티테넌트 불변조건

1. 모든 업무 테이블은 `organization_id`를 필수로 가진다.
2. 사용자 세션만으로 조직을 추정하지 않고 요청마다 조직 membership과 권한을 검증한다.
3. 회사 A의 작업·카드·원본·자격정보 참조가 회사 B에서 조회되지 않아야 한다.
4. Queue 메시지, object storage path, cache key와 감사 로그에도 조직 경계를 포함한다.
5. 플랫폼 운영자 권한과 고객사 관리자의 권한을 분리한다.
6. 자격정보 암호화 키는 최소 환경별로 분리하고, 상용 단계에서는 조직별 DEK를 적용한다.
7. 회사 삭제와 카드 연결 해제는 서로 다른 보존·폐기 정책을 가진다.

## 3. 공개 자료로 확인되는 하이픈형 시스템

### 3.1 상품 계층

하이픈의 법인카드 조회 상품은 여섯 개 기능을 제공한다.^1

| 기능 | 반환 정보 | TimeFit 필요성 |
| --- | --- | --- |
| 보유카드 조회 | 카드번호, 카드명 | 필수. 단 전체 번호는 즉시 폐기·토큰화 |
| 승인내역 조회 | 이용일시, 금액, 가맹점, 할부 | 필수 |
| 매입내역 조회 | 승인번호, 가맹점, 금액, 할부 | 필수 |
| 결제예정금액 조회 | 결제일, 금액, 계좌, 상세 | 2차 |
| 한도 조회 | 총한도, 사용액, 가용액 | 2차 |
| 카드번호 조회 | 카드번호 목록 | 제외 권장 |

### 3.2 실행 계층

하이픈 공개 자료는 세 가지 연계 형태를 설명한다.^2

1. 고객 서비스가 하이픈 Cloud API를 직접 호출한다.
2. 고객 장치에서 Local Scraping 라이브러리를 실행한다.
3. 고객 또는 제공사 서버에서 Server Scraping을 실행하고 결과를 내부 시스템과 연계한다.

TimeFit은 서버 수집을 기본으로 하되 공동인증서, 보안 프로그램, 장치 바인딩 때문에 서버 실행이 불가능한 카드사만 사용자 장치 커넥터를 검토한다. 장치 커넥터는 별도 설치·서명·자동 업데이트·변조 방지 체계가 필요하므로 초기 범위에서는 제외한다.

### 3.3 인증과 API 소비 계층

하이픈은 User ID와 HKey로 OAuth Access Token을 발급하고, 이후 API 호출에 Bearer Token을 사용하는 방식을 권장한다. 토큰 발급은 서버에서 수행해야 하며 공개 안내상 토큰 유효기간은 7일이다.^3 상품 신청, 권한 부여, 테스트베드, 호출별 과금 또는 계약형 후불 요금 체계도 별도 계층으로 제공한다.^4

TimeFit 내부 플랫폼은 외부 고객용 과금 계층을 당장 만들 필요가 없다. 대신 사업장·카드사·호출 목적 단위의 사용량과 원가를 기록해야 향후 외부 API 상품화 여부를 판단할 수 있다.

## 4. 권장 시스템 경계

```text
[TimeFit Web]
  연결 동의·카드 선택·상태 확인
          |
          v
[Connection API] ---- [Consent/Audit DB]
          |
          v
[Credential Broker] ---- [Cloud KMS + Secret Vault]
          |
          v
[Job Orchestrator] ---- [Queue / Scheduler / Rate Limiter]
          |
          v
[Connector Runtime]
  CardCompany-A / CardCompany-B / CSV Fallback
          |
          v
[Raw Response Vault] -> [Normalizer] -> [Immutable Event Store]
                                      -> [Transaction Grouper]
                                      -> [Expense Ledger]
          |
          v
[Monitoring / Reconciliation / Incident Console]
```

### 4.1 TimeFit Core

직원, 사업장, 지출 원장, 영수증, 결산을 담당한다. 카드사 자격정보 원문이나 브라우저 세션을 보유하지 않는다.

### 4.2 Connector Control Plane

연결 상태, 사용자 동의, 카드 선택, 스케줄, 커넥터 버전, 재인증 상태를 관리한다. 금융기관에 직접 로그인하지 않는다.

### 4.3 Connector Data Plane

금융기관에 실제 접속하는 격리 실행 환경이다. 작업마다 짧게 생성하고 종료하며, 실행 중에만 Vault에서 자격정보를 받아 메모리에 보유한다. 일반 웹/API 서버와 네트워크·권한을 분리한다.

### 4.4 Credential Broker

애플리케이션이 자격정보 원문을 직접 읽지 않도록 중개한다. Connector Runtime의 작업 ID, 조직 ID, 커넥터 ID, 목적과 만료 시간을 검증한 뒤 필요한 비밀만 단기 제공한다.

## 5. 사용자 흐름

### 5.0 회사 온보딩

1. 회사 소유자가 TimeFit 조직을 생성한다.
2. 사업자번호와 회사 대표 권한을 확인한다.
3. 최고관리자와 비용관리 담당자를 지정한다.
4. 카드 데이터 수집·처리·보존 조건에 회사 단위로 동의한다.
5. 회사별 Vault namespace와 데이터 보존정책을 생성한다.
6. 카드사 연결을 시작한다.

### 5.1 최초 연결

1. 사업장 소유자가 법인카드 자동 수집을 선택한다.
2. 수집 항목, 보유기간, 재위탁, 해제 방법을 확인하고 동의한다.
3. 지원 카드사를 선택한다.
4. 인증 방식에 따라 ID/PW, 인증서 또는 카드사 공식 OAuth를 진행한다.
5. Connector Runtime이 인증을 검증한다.
6. 보유카드 목록을 조회한다.
7. 원본 카드번호는 저장 전에 폐기하고 마지막 네 자리와 토큰만 반환한다.
8. 사용자가 수집 대상 카드를 선택한다.
9. 최근 90일 내역 백필을 시작한다.
10. Pilot 기간에는 CSV와 일별 순액 대조가 완료되면 연결 상태를 `active`로 전환한다.

### 5.1.1 카드 담당자와 지출 처리

1. 관리자가 조회된 카드에 직원·부서·매장을 연결한다.
2. 신규 승인 발생 시 해당 담당자에게 알림을 생성한다.
3. 담당자는 사유, 프로젝트·태그와 영수증을 입력한다.
4. 가맹점 자동화 규칙이 계정과목과 기본 사유를 제안한다.
5. 고신뢰 건은 정책에 따라 자동 분류하고 예외만 관리자에게 보낸다.
6. 취소·부분취소·매입 변경은 기존 지출과 동일한 거래 그룹에서 재계산한다.

### 5.2 정기 수집

1. Scheduler가 수집 기한이 된 연결을 선택한다.
2. Queue에 카드·조회 종류·기간별 작업을 생성한다.
3. Worker가 분산 잠금을 획득한다.
4. Vault에서 작업용 자격정보를 가져온다.
5. 카드사별 속도 제한을 적용해 조회한다.
6. 원본 응답을 암호화 저장하고 표준 이벤트로 변환한다.
7. 멱등 키로 중복을 제거한다.
8. 거래 그룹과 지출 원장을 갱신한다.
9. 성공 커서를 전진시키고 다음 실행 시각을 계산한다.
10. 실패 시 분류별 재시도 또는 재인증 상태로 전환한다.

### 5.3 재인증

- 인증 실패는 자동 반복하지 않는다.
- 기존 비밀은 화면이나 로그에 다시 표시하지 않는다.
- 새 자격정보로 보유카드 조회가 성공한 뒤에만 기존 비밀을 교체한다.
- 교체 주체·시각·커넥터 버전·검증 결과만 감사 로그에 기록한다.
- 교체 실패 시 기존 비밀을 유지하고 연결 상태는 `reauth_required`로 둔다.

### 5.4 연결 해제

- 신규 작업 생성 중단
- 예약 작업 취소
- 자격정보 즉시 폐기 또는 보존 예외 승인
- 수집 데이터 보존기간 정책 적용
- 카드와 기존 결산 이력은 감사 목적으로 보존 가능
- 해제 주체와 사유 기록

## 6. Connector SDK 설계

모든 카드사 구현은 동일한 계약을 따른다.

```typescript
interface CorporateCardConnector {
  capabilities(): ConnectorCapabilities;
  validateCredentials(input: CredentialInput): Promise<AuthResult>;
  listCards(session: ConnectorSession): Promise<CardAsset[]>;
  fetchApprovals(query: TransactionQuery): Promise<Page<RawEvent>>;
  fetchAcquisitions(query: TransactionQuery): Promise<Page<RawEvent>>;
  fetchBilling?(query: BillingQuery): Promise<Page<RawBilling>>;
  refreshSession?(session: ConnectorSession): Promise<AuthResult>;
  revoke?(session: ConnectorSession): Promise<void>;
  healthCheck(): Promise<ConnectorHealth>;
}
```

### 6.1 Connector manifest

각 커넥터는 코드 밖의 manifest로 다음을 선언한다.

- 지원 카드사와 기관 코드
- 인증 방식과 필수 필드
- 2FA 지원 여부
- 지원 조회 기능
- 허용 조회 기간과 페이지 크기
- 호출 제한과 권장 간격
- 점검 시간
- 카드사 사이트 또는 API 버전
- 개인정보 필드와 마스킹 규칙
- 변경 감지용 테스트 fixture

### 6.2 상태 머신

```text
draft
  -> authenticating
  -> discovering_assets
  -> backfilling
  -> reconciling
  -> active

active -> degraded -> active
active -> reauth_required -> authenticating
active -> paused
active -> disconnected
```

상태 변경은 반드시 원인 코드와 감사 이벤트를 동반한다.

## 7. 표준 데이터 모델

### 7.1 Connection

| 필드 | 설명 |
| --- | --- |
| `id` | 내부 연결 UUID |
| `organization_id` | 사업장 |
| `provider` | direct, scraper, csv 등 |
| `institution_code` | 카드사 코드 |
| `connector_version` | 실행한 커넥터 버전 |
| `credential_ref` | Vault 참조값, 비밀 원문 아님 |
| `status` | 연결 상태 |
| `consent_id` | 동의 증적 |
| `last_success_at` | 최근 성공 |
| `next_sync_at` | 다음 수집 |
| `last_error_category` | 오류 분류 |

### 7.2 Card Asset

| 필드 | 설명 |
| --- | --- |
| `provider_asset_token` | 원본 카드번호가 아닌 공급자 토큰 또는 HMAC |
| `last4` | 화면 표시용 마지막 네 자리 |
| `issuer` | 카드사 |
| `display_name` | 카드명 |
| `holder_hint` | 최소화된 사용자 표시값 |
| `status` | discovered, selected, inactive, disconnected |

전체 PAN을 영구 제거한 truncated 값만 처리하고 카드 데이터 환경을 분리하면 PCI DSS 범위를 줄일 가능성이 있다.^5 단, 실제 적용 범위는 QSA 또는 전문 보안 검토로 확정한다.

### 7.3 Immutable Card Event

- `provider_event_id`
- `provider_group_key`
- `event_type`: approval, cancellation, partial_cancellation, acquisition, billing
- `occurred_at`
- `amount`
- `approval_number`
- `merchant_name`
- `installment_months`
- `raw_response_id`
- `observed_at`
- `idempotency_key`

원본 이벤트는 수정하지 않는다. 카드사 정정은 새 이벤트 또는 새 관측 버전으로 기록하고, 현재 거래 상태는 projection으로 계산한다.

### 7.4 Transaction Group

승인·취소·매입·청구를 하나의 경제적 거래로 묶는다.

```text
approved_amount
- cancelled_amount
= net_amount

acquired_amount와 billed_amount는 별도 추적
```

## 8. 멱등성과 대사

### 8.1 멱등 키

공급자 고유 ID가 있으면 `provider + institution + event_id`를 사용한다. 없으면 다음 값을 정규화해 HMAC 지문을 만든다.

```text
organization
card_asset_token
approval_number
occurred_at
amount
event_type
merchant_normalized
```

단순 문자열 hash가 아니라 서버 비밀키를 사용하는 HMAC을 권장한다. 카드번호를 지문 입력으로 사용하더라도 원문을 저장하거나 로그에 남기지 않는다.

### 8.2 대사 규칙

- 최초 90일 API/스크래핑 결과와 카드사 CSV의 일별 승인·취소 순액 비교
- 승인번호 없는 거래는 시간·금액·가맹점·카드 토큰으로 후보 매칭
- 1원 이상 차이는 자동 통과 금지
- API와 CSV가 충돌하면 원본을 모두 보존하고 예외 업무 생성
- 재수집 세 번 후에도 이벤트 수와 합계가 동일해야 통과

## 9. 보안 설계

### 9.1 비밀정보

OWASP는 비밀정보를 중앙화된 Vault에 저장하고, 최소권한, 자동 회전, 만료·폐기, 변조 방지 감사 로그를 적용할 것을 권고한다.^6

- AWS Secrets Manager, Google Secret Manager 또는 HashiCorp Vault 사용
- KMS envelope encryption
- 조직별 또는 연결별 Data Encryption Key
- 운영자 평문 조회 권한 금지
- Worker의 일회성 workload identity
- 메모리 내 보유시간 최소화
- 로그·오류·APM에서 인증 필드 제거
- 백업에도 동일한 암호화·보존정책 적용

### 9.2 네트워크 격리

- Connector Runtime 전용 VPC/subnet
- 카드사 목적지 allowlist
- 고정 egress IP
- 일반 인터넷 outbound 차단
- 관리 접속은 bastion이 아니라 감사 가능한 세션 서비스 사용
- Web/API 서버에서 Connector DB 직접 접근 금지

### 9.3 감사 이벤트

- 동의 생성·철회
- 자격정보 생성·사용·교체·폐기
- 카드 발견·선택·해제
- 수집 시작·성공·실패
- 원본 데이터 열람·내보내기
- 관리자 권한 변경
- 보존 예외 승인

감사 로그에는 비밀값, 전체 카드번호, 인증서 내용, 세션 쿠키를 저장하지 않는다.

### 9.4 Secure SDLC

- 커넥터별 threat model
- 비밀 탐지와 SAST를 PR 필수 검사로 구성
- 의존성·컨테이너 이미지 스캔
- 프로덕션 데이터의 개발환경 복제 금지
- 카드사 응답 fixture는 비식별 합성 데이터 사용
- 커넥터 변경은 2인 승인
- 장애 시 kill switch와 카드사별 즉시 중단 기능

## 10. 법률·규제 조사 게이트

### 10.1 확인된 규제 배경

신용정보법은 신용정보업 또는 본인신용정보관리업을 허가 없이 영위하는 것을 금지한다.^7 개인 금융 마이데이터는 2022년 API 방식으로 전면 시행되면서 스크래핑이 금지됐고, 기능적합성·보안취약점 점검이 요구됐다.^8

다만 TimeFit이 다루려는 법인 명의 카드와 사업장 내부 회계업무가 곧바로 개인 마이데이터에 해당한다고 단정할 수는 없다. 임직원 이름, 개인사업자 카드, 사용자별 이용내역이 결합되면 개인정보·개인신용정보가 포함될 수 있으므로 출시 전 전문 법률 의견이 필요하다.

### 10.2 법률 검토 질문

1. 법인카드 거래 수집·분류가 신용정보업 또는 본인신용정보관리업에 해당하는가?
2. 사업장의 위임을 받아 카드사 사이트에 자동 접속하는 것이 카드사 약관상 허용되는가?
3. 개인사업자 카드와 법인카드를 동일 제품으로 처리할 수 있는가?
4. 직원별 카드 사용내역은 개인정보 또는 개인신용정보로 어떤 동의가 필요한가?
5. 인증정보와 공동인증서를 수탁 처리할 때 필요한 계약·고지·재위탁 조건은 무엇인가?
6. 외부 기업에 API를 판매할 때 추가 허가 또는 등록이 필요한가?
7. 국외 클라우드와 해외 리전에 저장 가능한 데이터 범위는 무엇인가?
8. 보존기간과 분쟁·세무 증빙 목적 보존의 법적 근거는 무엇인가?

법률 검토 전에는 개인카드, 개인사업자 카드, 외부 API 판매를 출시 범위에서 제외한다.

## 11. 운영 설계

### 11.1 SLO 초안

| 지표 | Pilot 목표 | 상용 목표 |
| --- | --- | --- |
| 일별 거래 완전성 | CSV 대비 99.9% | 99.99% |
| 중복 합산 | 0건 | 0건 |
| 데이터 신선도 | 6시간 이내 | 1~3시간 이내 |
| 인증 외 자동 복구 | 24시간 내 95% | 6시간 내 95% |
| 연결 상태 표시 정확성 | 99% | 99.9% |
| 감사 이벤트 누락 | 0건 | 0건 |

### 11.2 오류 분류

| 분류 | 처리 |
| --- | --- |
| authentication | 자동 중단, 사용자 재인증 |
| two_factor_required | 사용자 작업 요청, 제한시간 표시 |
| institution_maintenance | 점검 종료 후 재시도 |
| rate_limit | 카드사별 backoff |
| selector_changed | 커넥터 차단, 엔지니어 호출 |
| partial_response | 현재 커서 유지, 페이지 재시도 |
| network | 지수 backoff |
| invalid_request | 커넥터 버전 회귀 검사 |
| reconciliation_mismatch | 원장 자동 확정 금지 |

### 11.3 관제 화면

- 연결 수와 상태 분포
- 카드사별 성공률·응답시간
- 마지막 성공 및 데이터 지연시간
- 커넥터 버전별 실패율
- 인증 만료·2FA 대기
- 원본/표준 이벤트 수 차이
- API/CSV 대사 차이
- 호출 건수와 예상 원가
- 개인정보·자격정보 접근 감사

## 12. 인프라 선택

### 12.1 Pilot

- TimeFit Web/API: 기존 Vercel 유지 가능
- Control DB·Ledger: 기존 Supabase PostgreSQL
- Queue: 관리형 메시지 큐 또는 PostgreSQL outbox
- Worker: 고정 IP와 장기 실행이 가능한 컨테이너 서비스
- Vault/KMS: 클라우드 관리형 서비스
- Raw Storage: Object Storage + KMS + lifecycle
- Monitoring: 중앙 로그·메트릭·알림

Vercel 함수는 Control API에는 사용할 수 있지만 장기 브라우저 세션, 고정 IP, 인증서 모듈, 카드사별 실행 격리가 필요한 Connector Runtime의 주 실행 환경으로는 부적합하다.

### 12.2 상용 확장

- Kubernetes 또는 관리형 container jobs
- 카드사별 worker pool과 격리된 service account
- connector artifact 서명
- multi-region DR보다 국내 리전 이중화 우선
- append-only event storage와 별도 analytics replica
- SIEM·WAF·DDoS·Egress control

## 13. API 초안

### 13.1 내부 Control API

```text
POST   /v1/card-connections
POST   /v1/card-connections/{id}/authenticate
POST   /v1/card-connections/{id}/discover
PUT    /v1/card-connections/{id}/assets
POST   /v1/card-connections/{id}/backfill
POST   /v1/card-connections/{id}/sync
POST   /v1/card-connections/{id}/reauthenticate
DELETE /v1/card-connections/{id}
GET    /v1/card-connections/{id}/runs
GET    /v1/card-connections/{id}/audit
```

### 13.2 Worker 메시지

```json
{
  "jobId": "uuid",
  "organizationId": "uuid",
  "connectionId": "uuid",
  "connector": "card-company-a",
  "connectorVersion": "1.3.2",
  "operation": "fetch_approvals",
  "range": { "from": "2026-09-01T00:00:00+09:00", "to": "2026-09-11T23:59:59+09:00" },
  "credentialGrantId": "single-use-reference",
  "idempotencyKey": "opaque-value",
  "attempt": 1
}
```

메시지에는 비밀번호, 인증서, 카드번호, 세션 쿠키를 포함하지 않는다.

## 14. 개발 단계

### Phase 0 — 멀티테넌트 사업·법률·카드사 타당성, 2~4주

- 목표 고객군과 첫 Pilot 회사의 카드사·법인카드 유형 확인
- 회사 가입, 대표권한 확인과 관리자 역할 모델 확정
- 카드사 공식 기업 API·파일·이메일 옵션 우선 조사
- 카드사 약관과 자동 접근 허용 여부 확인
- 신용정보·개인정보 법률 의견
- 보안 데이터 분류와 retention 확정
- Build/Partner/CSV 의사결정

완료 기준: 여러 회사에 제공 가능한 법적·계약적 구조와 첫 지원 카드사 1곳을 서면으로 확정.

### Phase 1 — 멀티테넌트 Provider 연결 기반, 4~6주

- Control Plane 분리
- Vault/KMS 도입
- Queue, Scheduler, Worker Runtime
- Provider adapter와 manifest
- 상태 머신, 감사 로그, 원본 저장소
- 카드번호 즉시 토큰화·폐기
- 합성 fixture 테스트베드
- 조직별 RLS·Queue·Storage·Vault 격리 테스트
- 회사 관리자·비용 관리자·카드 사용자 권한

완료 기준: 서로 다른 두 테스트 회사가 같은 Provider를 사용해도 데이터·자격정보·작업이 섞이지 않고, 연결부터 원장까지 재현되며 비밀정보가 로그·DB에 없음.

### Phase 2 — Provider 기반 카드사 1곳 Pilot, 4~8주

- 인증과 2FA
- 보유카드 조회
- 승인·취소·부분취소·매입
- 90일 백필과 증분 커서
- Provider 응답·API 버전 변경 감지
- 재인증과 kill switch

완료 기준: Pilot 회사 카드 1장의 90일 데이터가 CSV와 일별 순액 기준 일치.

### Phase 3 — 운영 안정화, 4~6주 + Pilot 2주

- 카드사별 속도 제한
- 장애 자동 분류
- 운영 콘솔과 알림
- 비용·호출량 측정
- 백업·복원·자격정보 폐기 훈련
- 침투 테스트와 보안 리뷰

완료 기준: 2주간 중복 0건, 오합산 0건, 자격정보 노출 0건.

### Phase 4 — 카드사·Provider 확장, 연결당 2~6주

- 공통 SDK 재사용
- Provider/기관별 인증·응답 adapter
- 회귀 fixture
- 카드사별 운영 runbook

### Phase 5 — 외부 API 상품화, 별도 사업

- 고객 API Key/OAuth
- tenant quota와 과금
- 개발자 문서·sandbox
- 계약·SLA·지원 조직
- 외부 제공에 필요한 추가 법률·보안 검토

## 15. 조직과 역할

Pilot 최소 구성은 다음과 같다.

- Product/Operations 1명: 카드사·사업장 흐름, 대사 기준
- Backend/Platform 1~2명: Control Plane, Queue, Ledger
- Connector Engineer 1~2명: 카드사 인증·수집기
- Security/Infra 0.5~1명: Vault, IAM, 관제, 사고대응
- QA/Data 1명: CSV 대사, 회귀 fixture
- 외부 법률·개인정보 자문

1인이 모든 영역을 겸하면 Pilot은 가능하지만 상용 운영과 다중 카드사 확장은 위험하다. 특히 Connector 변경 대응과 보안 운영은 개발 완료 후에도 지속 업무다.

## 16. 비용 모델

정확한 금액은 카드사 방식과 호출량에 따라 달라지므로, 초기에는 금액보다 비용 동인을 측정한다.

| 비용 항목 | 주요 동인 |
| --- | --- |
| 개발 | 카드사 수, 인증 방식, 2FA, 응답 복잡도 |
| 인프라 | 연결 수, 수집 주기, 브라우저 실행시간 |
| 보안 | Vault/KMS, 로그, 침투 테스트, 인증 |
| 운영 | 사이트 변경 빈도, 인증 장애, 고객지원 |
| 법률 | 서비스 범위, 개인사업자 포함 여부, 외부 판매 |
| 데이터 | 원본 보존기간, 이미지·응답 크기 |

Build/Buy 비교에서는 하이픈 호출료만 보지 말고 자체 수집 시 카드사 변경 대응 인력과 24시간 장애 대응비를 포함한다. TimeFit은 여러 회사에 제공할 SaaS이므로 초기에는 전문 Provider를 사용하는 편이 출시 속도와 운영 위험 면에서 유리하다. 실제 호출량·원가·장애율이 축적된 뒤 일부 기관의 자체 Connector 전환을 판단한다.

## 17. 현재 TimeFit 코드 진단

### 재사용 가능

- Connection과 asset 상태 모델
- 90일 백필·증분 커서
- 불변 이벤트와 거래 그룹
- 멱등 import RPC
- 장애 분류와 backoff
- 재인증 화면·API·감사 로그
- 지출 원장·영수증 매칭·결산

### 교체 또는 분리 필요

- Vercel API 내부의 Connector 실행
- DB ciphertext 중심의 자격정보 저장을 전용 Vault reference로 전환
- 카드번호가 provider ID로 저장될 수 있는 fallback 제거
- 카드사 계약 필드가 확정되지 않은 범용 인증 폼
- 단일 프로세스 메모리 토큰 캐시
- 카드사별 rate limit·점검시간·2FA 상태 부재
- 원본 응답의 보존·마스킹·버전 정책 부재

### 즉시 중단 조건

- 전체 카드번호 또는 CVC가 로그·DB에 들어가는 경우
- 카드사 약관상 자동 접근이 금지된 경우
- 사용자의 명시적 위임·동의가 없는 경우
- 인증정보 접근 감사가 불가능한 경우
- 대사 불일치 상태에서 결산이 자동 확정되는 경우

## 18. 의사결정 게이트

| Gate | 결정 | 통과 조건 |
| --- | --- | --- |
| G0 | 자체 구축 착수 | 법률·약관상 허용 방식 확인 |
| G1 | 카드사 1곳 개발 | 인증·응답 명세와 테스트 계정 확보 |
| G2 | 운영 데이터 사용 | Vault·감사·마스킹 보안검토 통과 |
| G3 | 자동 원장 반영 | CSV 90일 대사 일치 |
| G4 | Pilot 확대 | 2주 오합산·중복·노출 0건 |
| G5 | 카드사 추가 | 첫 커넥터 운영비와 장애율 수용 가능 |
| G6 | 외부 API 판매 | 별도 법률·보안·사업성 승인 |

## 19. 다음 조사 체크리스트

1. 목표 고객군을 소규모 법인, 다매장 외식업, 일반 중소기업 중 어디부터 시작할지 확정한다.
2. 첫 Pilot 회사의 실제 법인카드 카드사·카드 유형·관리자 로그인 방식을 확인한다.
3. 카드사 공식 기업 API, 정기 파일, 이메일 전표, ERP 연동 상품을 우선 문의한다.
4. 카드사 사이트 이용약관에서 자동화 접근·자격정보 위임 조항을 확인한다.
5. 법인카드와 개인사업자 카드의 법적 처리 차이를 자문받는다.
6. 카드사별 2FA, 인증서, 보안프로그램 의존성을 기술 검증한다.
7. 전체 카드번호 없이 보유카드를 안정적으로 식별할 수 있는 필드를 확인한다.
8. 실제 CSV 90일 샘플로 표준 이벤트 모델과 대사 규칙을 검증한다.
9. 두 조직을 사용한 tenant isolation 자동 테스트를 설계한다.
10. 관리형 Vault/KMS와 장기 실행 Worker 인프라를 선정한다.
11. 카드사 1곳 Pilot 일정과 중단 기준을 확정한다.

## 20. Sources

1. HYPHEN. “[법인카드 조회](https://www.hyphen.im/product/view?seq=55).” 조회 2026-09-11.
2. HYPHEN. “[기업자금정보 패키지](https://www.hyphen.im/product-recommended-package/v1).” 조회 2026-09-11.
3. HYPHEN. “[OAuth 2.0 및 API 이용 가이드](https://hyphen.im/product-api/view?seq=36).” 조회 2026-09-11.
4. HYPHEN. “[테스트베드 사용법 안내](https://hyphen.im/customer/notice-view?seq=30).” 2022-03-02.
5. PCI Security Standards Council. “[FAQ 1117: Truncated PANs and PCI DSS scope](https://www.pcisecuritystandards.org/faqs/1117/).” 조회 2026-09-11.
6. OWASP Foundation. “[Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).” 조회 2026-09-11.
7. 국가법령정보센터. “[신용정보의 이용 및 보호에 관한 법률 제4조](https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000113294).” 시행 2026-08-13.
8. 금융위원회. “[금융 마이데이터 API 방식 전면 시행](https://www.fsc.go.kr/no010101/77182?curPage=13&srchBeginDt=2022-12-&srchCtgry=8&srchEndDt=&srchKey=sj8&srchText=).” 2022-01-04.
9. Granter. “[세상에서 가장 쉬운 법인카드 관리법](https://granter.biz/blog/%EC%84%B8%EC%83%81%EC%97%90%EC%84%9C-%EA%B0%80%EC%9E%A5-%EC%89%AC%EC%9A%B4-%EB%B2%95%EC%9D%B8%EC%B9%B4%EB%93%9C-%EA%B4%80%EB%A6%AC%EB%B2%95).” 2024-09-10.
10. Granter. “[카드 분석 화면 가이드](https://support.granter.biz/screen-guide/asset/card).” 조회 2026-09-11.
