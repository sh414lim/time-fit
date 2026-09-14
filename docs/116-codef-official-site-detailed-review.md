# CODEF 공식 홈페이지 기반 TimeFit 도입 검토

검토일: 2026-09-12

검토 범위: CODEF 공식 홈페이지, 멤버십·가격정책, 카드 개발가이드, 법인 보유카드 API, 법인 승인내역 API

## 1. 최종 판정

CODEF는 TimeFit 법인카드 내역 조회·수집의 상용 1순위 후보로 유지한다.

공식 개발가이드에서 다음 핵심 기능을 확인했다.

- 개인카드와 법인카드 API 분리
- 법인 보유카드 조회
- 법인카드 승인내역 조회
- 공동인증서 또는 카드사 홈페이지 ID 로그인
- Connected ID 기반 반복 조회
- 정상·취소·부분취소·거절 구분
- 취소금액
- 매입 여부와 매입일
- 승인번호, 가맹점, 사업자번호, 부가세
- 국내 14개 카드사

따라서 TimeFit P0인 `보유카드 → 승인·취소·부분취소 → 매입상태 → 지출 원장`을 구성할 가능성이 충분하다.

그러나 즉시 운영 연결할 수 있는 상태는 아니다. 가격이 상담형이며 인증수단 등록, 인증서 relay, 법인카드 API 계약 범위, 멀티테넌트 SaaS 제공 권한을 확인해야 한다. 또한 카드사별 조회기간과 로그인 제약이 달라 단일 수집 규칙을 적용하면 안 된다.

## 2. 홈페이지에서 확인한 서비스 구조

### 멤버십

| 플랜 | 데이터 | 제한 | 가격 |
|---|---|---|---|
| Sandbox | 테스트 데이터 | API 형식 확인 | 무료 |
| 데모버전 | 실제 기관 데이터 | 1개월, 하루 100회 | 무료 |
| 정식버전 | 실제 기관 데이터 | 호출량 기반 과금 | 별도 상담 |

정식버전은 호출량 제한 없이 사용할 수 있다고 안내하지만, 이는 무과금 무제한이라는 의미가 아니라 호출 건수에 따라 과금된다는 의미다. 또한 대상 카드사에 대한 과도한 호출은 IP 차단 또는 서비스 제한이 발생할 수 있다.

공식 홈페이지는 정식버전에 다음을 안내한다.

- 실제 데이터 호출
- API 호출량 무제한
- 신규 API 개발
- 기술 전담 게시판과 담당자 지원
- 사용량·오류·비용 통계
- 가격 별도 상담

## 3. 카드사 지원 범위

공식 카드 개발가이드 기준 14개 카드사를 지원한다.

| 카드사 | 기관코드 | 카드사 | 기관코드 |
|---|---|---|---|
| KB카드 | 0301 | 우리카드 | 0309 |
| 현대카드 | 0302 | 롯데카드 | 0311 |
| 삼성카드 | 0303 | 하나카드 | 0313 |
| NH카드 | 0304 | 전북카드 | 0315 |
| BC카드 | 0305 | 광주카드 | 0316 |
| 신한카드 | 0306 | 수협카드 | 0320 |
| 씨티카드 | 0307 | 제주카드 | 0321 |

카드사별로 지원 로그인 방식, 필수 파라미터, 조회기간, 추가 인증, 법인 권한구분이 다르다.

## 4. 인증 구조

### 공식 확인

- 법인카드는 공동인증서 또는 ID 로그인을 지원
- Connected ID 발급 시 등록한 계정정보로 기관 로그인
- API와 카드사에 따라 요구 로그인 방식이 다름
- 로그인 실패 누적 시 카드사 계정이 제한될 수 있음
- 일부 카드사는 추가 입력 또는 SMS 인증이 발생

### TimeFit 권장 구조

```text
TimeFit 연결 시작
→ CODEF 인증수단 등록/relay
→ Connected ID 수신
→ TimeFit은 Connected ID reference 저장
→ 기관코드 + Connected ID로 보유카드 조회
→ 승인내역 조회
```

TimeFit은 공동인증서·비밀번호·전체 카드번호를 일반 DB에 저장하지 않는다. CODEF 인증수단 등록 요청에서 민감정보가 TimeFit 서버를 거쳐야 한다면 메모리 사용 후 즉시 폐기하고 로그·오류 추적·APM에서 제거한다.

### 카드사별 주요 예외

- 롯데카드: 일부 법인관리자·법인공용카드는 인증서 로그인을 실사이트에서 지원하지 않음
- 롯데 법인공용카드: ID 로그인 시 매번 공용카드 인증이 필요해 지원 불가 조건 존재
- 신한카드: 법인 이용자/사업장·부서관리자/총괄관리자 권한 구분
- 우리카드: 비밀번호 오류 누적 시 사업자등록번호 추가 입력 가능
- 씨티카드: ID 로그인에서 SMS 추가 인증 가능

따라서 TimeFit 연결 마법사는 모든 카드사에 같은 ID/PW 폼을 보여주지 않고 CODEF 기관별 schema와 capability에 따라 동적으로 구성해야 한다.

## 5. 법인 보유카드 API

### Endpoint

```text
Demo       POST https://development.codef.io/v1/kr/card/b/account/card-list
Production POST https://api.codef.io/v1/kr/card/b/account/card-list
Timeout    240초
```

주요 입력:

- organization: 카드사 기관코드
- connectedId
- identity: 특정 오류 조건에서 사업자번호
- loginTypeLevel
- clientTypeLevel

주요 출력:

- 사용자/법인명
- 카드번호
- 카드명·카드구분
- 휴면 여부
- 발급일·유효기간·재발급일
- 부서코드·부서명
- 직전 카드번호
- 결제은행·결제계좌

### TimeFit 주의사항

`resCardNo`의 마스킹 위치와 형식이 카드사별로 다를 수 있다. 이를 Provider asset ID로 그대로 저장하면 안 된다.

권장 카드 식별:

1. CODEF가 별도 안정 ID를 제공하는지 계약 문의
2. 없다면 기관코드, Connected ID namespace, 정규화된 마스킹 카드번호, 카드명, 발급/재발급 정보를 HMAC
3. 화면에는 last4가 신뢰 가능할 때만 last4 표시
4. 원문 카드번호의 PAN 패턴을 DB write 전에 차단
5. 재발급 시 `previous_card_id` 관계 생성

카드별 승인 조회는 `cardNo` 입력을 요구할 수 있으므로 우선 `inquiryType=1` 전체조회를 사용하고, 카드별 구분은 응답의 마스킹 번호로 수행하는 방안을 Sandbox에서 검증한다.

## 6. 법인 승인내역 API

### Endpoint

```text
Demo       POST https://development.codef.io/v1/kr/card/b/account/approval-list
Production POST https://api.codef.io/v1/kr/card/b/account/approval-list
Timeout    300초
```

주요 입력:

- organization, connectedId
- startDate, endDate
- orderBy
- inquiryType: 카드별/전체/부서별
- cardNo, departmentCode
- applicationType: 전체/취소건
- memberStoreInfoType: 가맹점·부가세 포함 범위

TimeFit은 가맹점 사업자번호와 부가세를 사용하므로 운영 비용·응답시간을 확인한 뒤 `memberStoreInfoType=3`을 우선 검증한다.

### 핵심 출력

- 사용일·사용시간
- 마스킹 카드번호
- 이용금액·원화금액
- 승인번호
- 가맹점명·가맹점번호·사업자번호·업종·주소
- 수수료·부가세·봉사료
- 정상/취소/부분취소/거절
- 취소금액
- 매입 여부
- 매입일
- 국내/해외, 일시불/할부

### TimeFit 표준 이벤트 매핑

| CODEF | TimeFit |
|---|---|
| resCancelYN=0 | approval |
| resCancelYN=1 | cancellation |
| resCancelYN=2 | partial_cancellation |
| resCancelYN=3 | declined, 지출 합계 제외 |
| resCancelAmount | cancellation amount |
| resPurchaseYN=1 | acquired 상태 또는 acquisition projection |
| resPurchaseDate | acquired_at |
| resApprovalNo | approval_number |
| resMemberStoreCorpNo | merchant_business_number |
| resVAT | vat_amount 후보 |

CODEF 승인 응답에는 매입 여부·매입일이 포함되므로 MVP에서 별도 매입 API 없이도 상태 전이를 만들 수 있다. 다만 이 값이 카드사 CSV 매입내역과 100% 일치하는지 검증하기 전에는 월 결산 확정값으로 사용하지 않는다.

## 7. 취소·부분취소·매입 처리

CODEF는 `resCancelYN`으로 정상, 취소, 부분취소, 거절을 구분하고 `resCancelAmount`를 제공한다. 다만 공식 특이사항에 따르면 부분취소는 대상 카드사 사이트가 명확한 정보를 제공할 때만 정확히 구분되며 카드사별 차이가 존재한다.

따라서 다음 grouping key를 사용한다.

```text
기관코드
+ Connected ID namespace
+ 마스킹 카드 fingerprint
+ 승인번호
+ 원승인일시
+ 통화
```

승인번호가 없는 거래는 별도 fallback fingerprint로 묶되 자동 확정하지 않는다. 신한카드는 카드사용알림서비스 이용료·하이패스 등 승인번호가 없는 거래가 skip될 수 있다는 공식 예외가 있으므로 CSV 대사가 필요하다.

## 8. 조회기간과 동기화 정책

공식 법인 승인 API의 카드사별 조회 가능기간:

| 카드사 | 조회 가능기간/제약 |
|---|---|
| 삼성·롯데·현대 | 최근 3개월 |
| 신한 | 최근 6개월, 1주일 단위 |
| KB·우리·하나·NH | 최근 12개월 |
| 씨티 | 최근 12개월, 3개월 단위 |
| BC | 최근 2년, 1개월 단위 |
| 전북 | 최근 4년 |
| 광주 | 최근 10년, 1년 단위 |
| 수협 | 기간 제한 없음, 6개월 단위 |
| 제주 | 제한 없음으로 안내 |

CODEF는 요청기간이 1회 최대 범위를 넘으면 내부적으로 분할 후 통합한다고 안내한다. 그래도 TimeFit은 90일 전체를 단일 HTTP 요청으로 실행하지 않는다.

권장 정책:

- 최초 백필: 최근 89일 또는 카드사 capability 내 안전 범위
- 기간 job: 기본 7일 단위
- 기본 증분: 하루 3회
- 사용자 필요 시: 비용·차단 정책 내 제한적 수동 동기화
- 최근 7일 overlap 재조회
- 월초 전월 전체 재대조
- 카드사/기관별 최소 호출 간격
- 인증 오류 시 즉시 자동 재시도 중단

그랜터도 기본 하루 3회 조회를 안내하므로 TimeFit 초기 운영 주기로 현실적이다. 1시간 조회는 CODEF와 대상 카드사의 허용 범위를 서면 확인한 고객 플랜에만 적용한다.

## 9. 성능·운영 위험

### 긴 응답시간

- 보유카드 timeout 240초
- 승인내역 timeout 300초

브라우저 요청이나 짧은 Vercel Function에서 완료를 기다리면 안 된다.

```text
사용자 요청
→ 202 + syncRunId
→ Queue Worker
→ CODEF 호출
→ 이벤트 저장
→ 진행률 갱신
→ 완료 알림
```

### 과도한 호출

공식 가이드는 과도한 API 호출 시 대상기관 IP 차단과 배치형/비정상 호출에 따른 이용 제한 가능성을 명시한다.

필수 통제:

- 조직·Connected ID·기관별 rate limit
- 수동 새로고침 cooldown
- 동일 기간 요청 병합
- 429/차단 오류 circuit breaker
- 승인된 스케줄러 한 계층에서만 재시도
- backoff+jitter
- 비용 및 호출량 모니터링

## 10. 비용 검토

공식 홈페이지에서 확인되는 가격:

- Sandbox: 무료
- Demo: 실제 데이터, 1개월간 하루 100회 무료
- Production: 호출 건수 기반 과금, 별도 상담

홈페이지에는 다음 금액이 공개되지 않는다.

- 정식 월 기본료
- 법인 보유카드 호출 단가
- 법인 승인내역 호출 단가
- 무내역·오류 응답 과금
- Connected ID 생성·유지 비용
- 인증서 relay 비용
- 초기 구축비·최소 약정
- 가맹점·부가세 포함 옵션의 비용 차이

따라서 현재 CODEF의 월 상용비용은 계산할 수 없다. 데모 1개월/일 100회를 이용해 기술 검증은 가능하다.

견적 요청량:

```text
고객사당 평균 카드 3장
보유카드 월 1회
승인내역 하루 3회
최근 7일 overlap
월초 전월 전체조회
고객사 1 / 10 / 100 / 1,000곳
```

과금 단위가 API 요청, 내부 기간분할, 카드사 로그인, 반환건수 중 무엇인지 반드시 확인한다.

## 11. TimeFit 현재 설계 수정사항

### 유지

- Provider Adapter
- card_connections, corporate_cards
- 불변 card_transaction_events
- card_transaction_groups
- 7일 overlap
- CSV fallback과 대사

### 수정

1. 현재 Hyphen 전용 인증 필드를 CODEF 기관 capability schema로 교체
2. 연결에 `provider=codef`, `connected_id_reference`, `organization_code` 추가
3. `cardNo`를 Provider ID로 저장하는 fallback 제거
4. `declined` 이벤트 또는 제외 원천 상태 추가
5. `resPurchaseYN/resPurchaseDate` projection 정책 추가
6. 카드사별 조회기간·권한·로그인 capability 테이블 추가
7. sync API를 비동기 202 응답으로 변경
8. CODEF 오류코드와 userError 상태 분류
9. 계정 잠금 직전 오류에서는 자동 재시도 중단
10. 가맹점·부가세 옵션별 비용·응답 품질 측정

## 12. Demo 검증 시나리오

1. CODEF 계정 생성 및 Sandbox key 발급
2. 법인카드 보유카드 Sandbox 호출
3. 법인 승인내역 Sandbox 호출
4. Demo 신청 후 실제 테스트 법인 인증수단 등록
5. Connected ID 생성
6. 보유카드 전체조회
7. 최근 89일 승인 전체조회
8. 정상·전체취소·부분취소·거절 확인
9. 매입 여부·매입일 확인
10. 가맹점·부가세 옵션 확인
11. 같은 기간 세 번 조회 후 중복 0건 확인
12. 카드사 CSV와 승인·취소·순액 대사

Demo 합격 기준:

- 보유카드 발견 성공
- 승인·취소·부분취소 mapping 성공
- 카드사 CSV 대비 누락·오합산 0건
- Connected ID만으로 반복 조회 가능
- 인증정보와 PAN이 TimeFit DB·로그에 남지 않음
- 호출량과 예상 상용비용 산출 가능

## 13. 계약 전 질문

1. TimeFit 하위 고객사에 가공 금융데이터와 결산을 제공할 수 있는가?
2. Connected ID와 인증수단은 어떤 방식으로 저장·파기되는가?
3. TimeFit 서버가 공동인증서·비밀번호를 받지 않는 relay 방식이 가능한가?
4. 법인 보유카드·승인 API 정식 단가는 얼마인가?
5. 내부 기간분할 호출은 몇 건으로 과금되는가?
6. 정상 무내역과 기관 오류도 과금되는가?
7. 부분취소 원승인 연결을 위한 별도 ID가 있는가?
8. 매입 여부·매입일을 결산 확정값으로 사용해도 되는가?
9. 별도 법인카드 매입 API가 있는가?
10. 카드번호를 보내지 않는 전체조회만으로 카드별 내역을 안정적으로 구분할 수 있는가?
11. 카드사별 권장 최소 호출 간격과 IP 차단 기준은 무엇인가?
12. 장애·카드사 변경 SLA와 기술지원 범위는 무엇인가?

## 14. 최종 결론

CODEF 공식 홈페이지 검토 결과, 앞선 조사보다 TimeFit 적합성이 더 명확해졌다. 특히 법인 승인내역 한 API에서 취소·부분취소·매입상태까지 제공하므로 핵심 수집 모델을 구현할 수 있다.

다만 다음 네 가지가 해결되기 전에는 상용 Provider로 확정하지 않는다.

```text
SaaS 제공 권리
+ 인증서/비밀번호 TimeFit 비보관
+ 실제 카드 CSV 100% 대사
+ 상용 단가 수용 가능
```

현재 권고:

```text
기술 적합성       높음
Demo 착수         권장
상용 계약         견적·권리 확인 필요
TimeFit 주 후보   유지
```
