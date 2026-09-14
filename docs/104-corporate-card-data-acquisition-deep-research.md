# TimeFit 법인카드 데이터 수집 방식 심층 조사

## 1. 경영진 결론

TimeFit의 법인카드 지출내역 수집은 한 가지 방식에 의존하면 안 된다. 한국 시장에서 가장 현실적인 구조는 **공식 ERP/EDI 연계 또는 전문 Provider를 주 수집망으로 사용하고, CSV를 필수 복구·대사 수단으로 제공하며, 이메일 전표는 보조적인 조기 알림 수단으로 제한하는 것**이다. 자체 Connector는 계약 가능한 공식·전문 연계로 지원할 수 없는 기관이 충분히 쌓인 뒤에만 검토해야 한다.

중요한 발견은 “카드사 공식 API”와 “전문 Provider”가 실무에서 완전히 분리되지 않는다는 점이다. 현대카드는 법인카드 ERP 연계에서 카드사와 중계업체가 신청을 처리하고 쿠콘·파투아를 데이터 중계업체로 명시한다.^1 하나카드도 기업 ERP 자동전송을 제공하면서 파투아·쿠콘·KSNET·기웅정보통신을 대행업체로 안내한다.^2 즉, 카드사에서 정식 승인된 데이터라도 TimeFit이 카드사 REST API를 직접 호출하는 대신 승인된 중계망으로 받을 수 있다.

권장 수집 우선순위는 다음처럼 수정한다.

1. **카드사 공식 ERP/EDI·제휴 연계**: 직접 계약 또는 카드사가 지정한 중계사를 통한 공식 데이터
2. **전문 Provider API**: 하이픈 등으로 카드사 범위를 빠르게 확보
3. **CSV 업로드**: 모든 고객에게 제공하는 온보딩·대사·장애 복구 수단
4. **이메일 전표 수신**: 승인 직후 알림과 증빙 요청을 빠르게 만드는 보조 수단
5. **자체 Connector**: 마지막 수단이며 별도 Go/No-Go 승인을 받은 기관만 개발

MVP는 `전문 Provider 1개 + CSV` 조합이 가장 빠르다. 동시에 카드사 공식 ERP/EDI 제휴를 추진하고, 계약이 성사된 카드사는 동일 Provider 인터페이스에 공식 adapter로 추가한다. 이메일은 전체 메일함을 읽는 Gmail OAuth보다 회사별 전용 수신 주소로 전달받는 구조가 권한과 운영 부담이 작다.

## 2. 조사 범위와 용어

이 문서는 회사가 비용으로 사용한 **법인카드 매입 측 데이터**를 대상으로 한다. 가맹점이 고객에게 받은 카드 매출을 조회하는 “카드 매출/입금 조회”와는 다른 데이터다. TimeFit은 두 데이터를 별도 연결로 취급해야 한다.

- 법인카드 지출: 회사 카드의 보유카드, 승인, 취소, 매입, 청구, 한도
- 가맹점 카드 매출: 매장의 카드 승인, 매입, 수수료, 입금 예정과 입금
- 이메일 전표: 승인 알림, 이용대금명세서, 전자영수증 또는 전달된 결제 알림
- 공식 API: 카드사가 승인한 제휴 API뿐 아니라 ERP/EDI 파일·전용망 연계 포함
- 전문 Provider: 여러 카드사의 화면·제휴망·데이터를 공통 API로 중계하는 사업자
- 자체 Connector: TimeFit이 카드사 웹 로그인과 화면/네트워크 응답을 직접 자동화하는 수집기

## 3. 방식별 비교

| 기준 | 카드사 공식 ERP/EDI | 전문 Provider | CSV | 이메일 전표 | 자체 Connector |
| --- | --- | --- | --- | --- | --- |
| 데이터 권위 | 가장 높음 | 중상~높음 | 높음, 추출 시점 기준 | 중간 | 중간 |
| 도입 속도 | 느림 | 빠름 | 가장 빠름 | 빠름 | 느림 |
| 카드사 범위 | 계약 카드사별 | 한 번에 다수 | 카드사별 수작업 | 발송 지원 카드사 | 직접 개발한 카드사만 |
| 실시간성 | 계약에 따라 우수 | 상품별 상이 | 수동 업로드 시 낮음 | 알림이면 빠름 | 구현에 따라 빠름 |
| 취소·매입 정확성 | 우수 | 상품/카드사별 확인 | 내려받은 파일 범위에 따름 | 알림 누락·정정 취약 | 지속 대사 필요 |
| 초기 개발비 | 중간 | 낮음~중간 | 낮음 | 중간 | 매우 높음 |
| 지속 운영비 | 낮음~중간 | 호출료 | 고객 수작업 | parser 유지 | 매우 높음 |
| 인증정보 책임 | 비교적 낮음 | 계약에 따라 TimeFit 부담 | 없음 | 전달 설정 또는 메일 OAuth | 가장 큼 |
| 장애 복구성 | 계약/SLA | Provider 의존 | 높음 | 중간 | 자체 책임 |
| MVP 적합성 | 병행 추진 | **주 수단** | **필수** | 선택 | 부적합 |

## 4. 카드사 공식 API·ERP/EDI 연계

### 4.1 공개 조사로 확인되는 실제 형태

한국 카드사의 공개 개발자 포털이 존재하더라도 법인카드 지출내역 조회가 누구에게나 열려 있다는 뜻은 아니다. KB금융 API 포털은 다양한 API와 제휴 절차를 제공하지만, 대표 카드 API는 카드 발급 신청과 같은 제휴 서비스로 소개된다.^3 BC Open API의 공개 명세 역시 카드 회원 등록·발송·회원 관리 등 제휴 카드 프로세싱 중심이며, TimeFit이 원하는 기존 법인회원의 전체 지출내역 조회와 동일한 상품이라고 볼 수 없다.^4

반면 카드사 기업 홈페이지에서는 법인카드 ERP/데이터 연계를 명시적으로 확인할 수 있다.

- 현대카드 ERP 연계서비스: 보유카드, 승인내역, 청구내역, 한도 정보를 제공하며 총괄관리자가 온라인 신청한 뒤 카드사와 중계업체가 접수한다. 공개 안내에는 쿠콘 iCATs와 파투아 VCCS가 중계업체로 기재돼 있다.^1
- 하나카드 기업카드 통합관리: 카드별·건별·조직별 거래내역, 파일 저장, ERP Direct Connection과 전송 로그 로그를 제공한다. 파투아·쿠콘·KSNET·기웅정보통신이 대행업체로 안내된다.^2
- 삼성카드 Ez-Work: 법인별·상품별 데이터 자동 제공, ERP 자동 연계, 이용내역 분석을 제공하며 외부감사 대상 법인이 영업담당자와 협의해 이용하는 형태다.^5
- 쿠콘 법인카드 EDI: 승인·매입·청구·한도 등 정보를 카드사에서 직접 수신하고 국내 전 카드사를 지원한다고 안내한다.^6

따라서 TimeFit이 말하는 “공식 API”는 다음 세 형태로 나눠 조달해야 한다.

1. 카드사와 TimeFit의 직접 제휴 API
2. 고객 회사가 카드사 ERP 연계를 신청하고 TimeFit 또는 지정 중계사가 수신
3. 카드사로부터 정식 수신하는 EDI 사업자의 API를 TimeFit이 이용

### 4.2 예상 계약·온보딩 흐름

1. TimeFit이 카드사 또는 EDI 중계사에 서비스 구조와 고객 유형을 제출한다.
2. 카드사/중계사가 제공 가능 데이터, 재제공 범위, 보안 심사와 요금을 회신한다.
3. Pilot 고객이 법인 총괄관리자 권한으로 데이터 연계 신청서와 동의서를 제출한다.
4. 카드사·중계사가 고객 사업자번호와 수신처를 등록한다.
5. 테스트 데이터 또는 검증 계정으로 카드 목록과 거래를 수신한다.
6. 카드사 CSV와 승인·취소·매입 합계를 대사한다.
7. 운영 전환 후 전송 상태와 누락 재전송 절차를 점검한다.

실제 방식은 REST pull, webhook push, SFTP/file, 전용선/VPN 중 하나일 수 있다. 공개 웹 정보만으로 카드사별 프로토콜을 확정할 수 없으므로 RFP에서 반드시 확인해야 한다.

### 4.3 RFP 필수 질문

데이터:

- 보유카드, 승인, 승인취소, 부분취소, 매입, 매입취소, 청구, 한도 중 지원 범위
- 법인공용/법인개별/체크/하이패스/해외 카드 지원 여부
- 승인번호, 원승인번호, 카드 식별자, 가맹점 사업자번호, MCC 제공 여부
- 해외 원화/현지통화/환율/수수료 필드
- 카드 재발급 전후 연계 식별자
- 과거 조회 가능 기간과 최대 페이지/파일 크기

전송:

- push/pull 방식, 평균/최대 지연, 재전송 방법
- cursor, sequence, file control total, checksum 제공 여부
- 중복 전송 시 고유키 안정성
- 테스트/운영 환경 분리와 고정 IP·mTLS·VPN 요구
- schema 변경 사전 통지 기간

계약·운영:

- TimeFit이 다수 고객사 데이터를 처리할 수 있는지
- 고객별 신청서와 해지서 형식
- 재위탁·재제공·국외 이전 제한
- 장애 SLA, 지원 시간, 과거 데이터 재생 비용
- 기본료, 고객사/카드/호출/파일별 요금

### 4.4 TimeFit adapter 설계

공식 연계 adapter도 전문 Provider와 동일한 내부 계약을 사용한다.

```text
discoverAssets(connection) -> CardAsset[]
fetchEvents(connection, asset, range, cursor) -> EventPage
acknowledgeDelivery(deliveryId)
replay(range)
disconnect(connection)
healthCheck()
```

push 파일을 받더라도 즉시 원장에 쓰지 않는다. `delivery receipt → 무결성 검사 → quarantine → schema validation → immutable event → transaction group → expense ledger` 순으로 처리한다. 파일의 레코드 수와 금액 control total이 있다면 원본과 적재 결과를 비교한다.

### 4.5 장단점과 판정

장점:

- 카드사 또는 정식 중계망에서 받은 데이터라 출처와 정합성이 가장 명확하다.
- 화면 변경에 영향을 덜 받고 재전송·장애 지원을 계약으로 다룰 수 있다.
- 고객에게 “공식 연계”라는 신뢰를 제공할 수 있다.

한계:

- 카드사마다 계약, 심사, 데이터 포맷과 운영 창구가 달라 확장이 느리다.
- 소규모 SaaS에는 직접 계약보다 지정 중계업체 경로만 열릴 수 있다.
- 공개 포털에 API가 보여도 법인 지출 조회 권한이 별도 제휴 상품일 가능성이 높다.

판정: **중장기 최우선 수집망으로 승인하되, MVP 일정을 공식 계약 하나에 종속시키지 않는다.**

## 5. 카드사 CSV·Excel 파일

### 5.1 어떤 파일을 대상으로 해야 하는가

카드사 기업 홈페이지에는 이용내역 조회·출력과 파일 저장 기능이 존재한다. 삼성카드 법인 메인은 승인내역, 매출/청구내역, 결제예정금액과 이용내역 출력을 제공한다고 안내하며,^7 하나카드는 원하는 형태의 거래내역 파일 저장과 템플릿 보관을 안내한다.^2 삼성카드의 일부 법인 화면은 조회 결과의 Excel 다운로드와 양식 업로드를 명시한다.^8

다만 모든 카드사가 동일한 CSV 열과 인코딩을 제공한다는 공개 근거는 없다. TimeFit은 “CSV만”이 아니라 다음을 수용해야 한다.

- CSV: UTF-8, CP949/EUC-KR, 쉼표/탭 구분
- XLSX: 첫 시트 또는 사용자가 선택한 시트
- XLS: 가능하면 고객에게 XLSX/CSV 재다운로드 안내, 필요 시 제한 지원
- 카드사 제공 표준 템플릿과 사용자가 재가공한 회계 파일 구분

PDF 명세서는 사람이 검토하는 증빙에는 적합하지만 행 단위 거래 적재의 기본 포맷으로 사용하지 않는다. 표 추출 오류와 원본 레이아웃 변경을 데이터 수집 파이프라인이 떠안게 되기 때문이다.

### 5.2 권장 업로드 UX

1. 회사와 카드사를 선택한다.
2. 파일을 드래그하거나 선택한다.
3. 파일 hash로 동일 파일 재업로드를 탐지한다.
4. encoding, delimiter, header row, date/amount 형식을 자동 추정한다.
5. 처음 20행을 보여주고 TimeFit 표준 필드 매핑을 제안한다.
6. 카드번호가 있으면 화면에는 last4만 표시하고 서버에서 즉시 최소화한다.
7. 정상/경고/제외 행 수와 예상 순액을 저장 전에 표시한다.
8. 사용자가 확정하면 staging에 적재한다.
9. 중복·취소·매입을 계산한 뒤 원장 반영 결과를 제공한다.
10. 오류 행은 원문 전체가 아닌 행 번호·열·사유가 포함된 리포트로 내려준다.

### 5.3 표준 필드 매핑

| 표준 필드 | 가능한 카드사 열 이름 | 필수성 | 처리 |
| --- | --- | --- | --- |
| issuer | 카드사/발급사 | 필수 또는 업로드 선택값 | 정규 코드로 변환 |
| card_reference | 카드번호/카드별칭 | 필수 | PAN 폐기 후 token + last4 |
| occurred_at | 이용일시/승인일시 | 필수 | KST 기준 명시 |
| amount | 이용금액/승인금액 | 필수 | 숫자·부호 정규화 |
| event_type | 승인/취소/매입구분 | 권장 | 없으면 별도 파일 유형으로 추론 |
| approval_number | 승인번호 | 권장 | 거래 결합 핵심 키 |
| original_approval_number | 원승인번호 | 권장 | 부분취소 연결 |
| merchant_name | 이용가맹점/가맹점명 | 권장 | 공백·법인 접미사 정규화 |
| merchant_business_number | 가맹점 사업자번호 | 선택 | 분류 규칙 최우선 키 |
| currency/foreign_amount | 통화/현지금액 | 해외 필수 | KRW와 별도 보존 |
| acquisition_date | 매입일 | 매입 파일 권장 | 승인과 매입 상태 결합 |

### 5.4 멱등성과 대사

파일 hash만으로 중복을 막으면 같은 거래를 다른 기간 파일로 다시 올렸을 때 중복된다. 다음 계층을 함께 사용한다.

```text
file_idempotency = SHA-256(file bytes)
row_fingerprint = HMAC(org key,
  issuer + card_token + occurred_at + amount + approval_number + event_type)
business_group = issuer + card_token + approval_number + original_approval_number
```

업로드마다 다음 control total을 저장한다.

- 원본 행 수
- 정상/제외/오류 행 수
- 승인 합계, 취소 합계, 순액
- 카드별·일별 건수와 순액
- 중복으로 제외한 기존 event ID

### 5.5 보안 설계

- 파일은 조직별 격리 경로에 업로드하고 실행 파일·매크로를 허용하지 않는다.
- XLSX는 압축 폭탄, 과도한 행/열, formula injection을 검사한다.
- CSV export 시 `=`, `+`, `-`, `@`로 시작하는 사용자 문자열을 안전하게 처리한다.
- 원본 파일 보존은 기본 30일 이하로 하고, 추출 이벤트와 감사 기록은 회사 정책에 따른다.
- 파일에 전체 PAN이 포함되면 원본 보존 여부를 별도 정책으로 통제하고 가능한 한 즉시 파기한다.
- parser는 격리 worker에서 실행하고 파일명·셀 값을 로그에 그대로 출력하지 않는다.

### 5.6 장단점과 판정

장점:

- Provider 계약 전부터 모든 회사가 사용할 수 있다.
- 실제 카드사 원본과 API 결과를 대사하는 기준이 된다.
- API 장애 시 데이터 복구가 가능하다.
- 고객이 인증정보를 TimeFit에 맡길 필요가 없다.

한계:

- 사용자가 정기적으로 내려받아 업로드해야 한다.
- 카드사별 열, 인코딩, 날짜·취소 표현이 다르다.
- 실시간 알림과 자동 증빙 요청에는 부적합하다.

판정: **MVP 필수 기능이며 폴백이 아니라 품질보증 수단으로 취급한다.**

## 6. 이메일 전표·승인 알림

### 6.1 이메일 데이터의 종류

“이메일 전표”는 하나의 표준 상품이 아니다.

1. 건별 승인/취소 알림 본문
2. 월 이용대금명세서 PDF/HTML
3. 전자영수증 또는 카드사/경비관리 서비스 링크
4. 사용자가 TimeFit으로 전달한 영수증 사진·PDF

카드사별 발송 채널도 이메일로 고정되지 않는다. 삼성카드는 법인카드 명세서와 이용내역 조회를 제공하지만 명세서 수령은 앱·카카오톡·문자 방식도 안내한다.^7 ^9 현대카드는 법인카드 실시간 알림과 전자영수증 제출을 비즈플레이 연계 서비스로 제공한다.^10 따라서 “모든 카드사가 동일한 승인 이메일을 발송한다”는 가정으로 제품을 설계하면 안 된다.

### 6.2 권장 수신 방식

#### 방식 A — 회사별 전용 전달 주소: 권장

회사는 카드사 알림 또는 특정 필터만 다음과 같은 전용 주소로 전달한다.

```text
card+{opaque-organization-token}@inbound.timefit.example
```

수신 도메인의 MX를 메일 수신 서비스에 연결하고, 실제 envelope recipient로 조직을 식별한다. AWS SES는 수신 규칙으로 이메일을 S3에 저장하거나 Lambda/SNS 처리를 실행할 수 있고 스팸·바이러스·인증 검사 결과를 제공한다.^11 수신자 판정에는 위조 가능한 `To` 헤더가 아니라 수신 이벤트의 recipients 필드를 사용하라는 공식 권고가 있다.^12

#### 방식 B — Gmail/Workspace OAuth: 후순위

Gmail API는 mailbox 변경 push 알림과 `historyId` 기반 증분 처리를 지원한다.^13 그러나 본문이나 첨부파일을 읽는 scope는 Restricted scope이며 OAuth 앱 검증과 데이터 처리 요건의 영향을 받는다.^14 회사 전체 메일함 접근은 최소권한 원칙에도 불리하므로, 전용 라벨/메일함을 제공할 명확한 고객 수요가 있을 때만 도입한다.

#### 방식 C — 사용자의 수동 전달

직원이 영수증 메일을 TimeFit 전용 주소로 직접 전달한다. 구현은 쉽지만 sender와 조직 매칭, 중복 전달, 원본 발신자 확인이 필요하다.

### 6.3 처리 파이프라인

```text
MX receive
→ SPF/DKIM/DMARC·spam·virus 결과 확인
→ organization token 확인
→ raw MIME 암호화 격리 저장
→ sender/template 식별
→ HTML/text/attachment 추출
→ PAN·개인정보 최소화
→ standardized candidate event 생성
→ API/CSV event와 matching
→ 성공 시 증빙 또는 조기 알림으로 연결
→ 불명확하면 quarantine/수동 검토
```

이메일에서 만든 거래는 기본적으로 `candidate`다. API 또는 CSV 원장과 매칭되기 전에는 결산 금액의 독립 원천으로 합산하지 않는다. 이유는 전달 실패, 발송 지연, 중복, HTML template 변경, 해외 승인 후 금액 정정이 발생할 수 있기 때문이다.

### 6.4 Template parser 설계

각 parser는 다음 manifest를 가진다.

- issuer와 sender allowlist
- subject/body signature
- 지원 template version
- 필수 필드와 selector/regex
- 날짜·통화 timezone
- 승인/취소 구분 규칙
- 샘플 fixture와 마지막 검증일

parser 결과에는 신뢰도를 부여한다.

- 0.95 이상: 기존 API/CSV 거래의 증빙 자동 연결 가능
- 0.70~0.95: 직원/관리자 확인 요청
- 0.70 미만: quarantine, 원장 반영 금지

sender 주소만으로 신뢰하지 않는다. SPF/DKIM/DMARC 결과, Message-ID, 원본 발신자, body signature와 기존 카드 last4를 함께 확인한다.

### 6.5 보안·개인정보

이메일은 예상치 못한 전체 PAN과 첨부파일을 포함할 수 있다. PCI SSC는 PAN이 이메일 같은 end-user messaging 기술로 송수신되면 관련 채널과 시스템이 PCI DSS 범위에 들어갈 수 있다고 설명한다.^15 CVC는 승인 후 암호화 여부와 관계없이 저장하면 안 된다.^16

따라서 다음을 적용한다.

- TimeFit 주소로 카드번호/CVC를 보내지 말라는 사용자 안내
- 수신 즉시 PAN 탐지·마스킹/최소화, CVC 의심 콘텐츠 quarantine 후 파기
- 원문 접근을 일반 운영자에게 차단
- 원문 짧은 보존기간과 자동 삭제
- 첨부파일 malware scan, HTML active content 제거
- 외부 이미지 자동 로딩 차단
- 조직별 opaque address rotation과 폐기

### 6.6 장단점과 판정

장점:

- 건별 승인 알림이 제공되면 API 주기보다 빨리 직원에게 증빙을 요청할 수 있다.
- 별도 카드사 로그인 비밀번호를 받지 않을 수 있다.
- 전자영수증/PDF를 거래와 연결하는 입력 채널이 된다.

한계:

- 카드사와 고객 설정에 따라 이메일 자체가 없을 수 있다.
- template 변경과 스팸/전달 실패를 계속 운영해야 한다.
- 취소·매입·최종 청구를 완전하게 보장하지 못한다.
- 전체 메일함 OAuth는 검증·권한·개인정보 부담이 크다.

판정: **결산 원천이 아니라 조기 알림과 증빙 보조 채널로 승인한다. 전용 전달 주소를 우선하고 Gmail 전체 접근은 후순위로 둔다.**

## 7. 전문 Provider 검토 — 기존 우선순위 2번

### 7.1 하이픈 공개 상품

하이픈은 법인카드 조회를 스크래핑 방식 API로 명시하고 보유카드, 결제예정금액, 승인, 매입, 카드번호, 한도 6개 API를 제공한다.^17 TimeFit MVP에는 보유카드·승인·매입이 필요하고, 카드번호 조회는 제외해야 한다. 취소·부분취소가 별도 API인지 승인/매입 응답 상태로 표현되는지는 계약 개발가이드에서 확인해야 한다.

하이픈은 OAuth 2.0을 권장하며 User ID와 HKey로 서버에서 Access Token을 발급하고 공개 안내상 토큰 유효기간은 7일이다. 민감 필드는 별도 암호화가 필요할 수 있다.^18 가격은 공개 페이지 기준 TR슬림 월 멤버십 10만원과 건별 과금, TR시그니처 월 기본료 30만원 이상과 계약형 후불 구조로 안내되지만 실제 법인카드 API 단가는 상담 확인이 필요하다.^17

하이픈은 Cloud API 외에 고객 장치의 Local Scraping과 고객 서버의 Server Scraping도 제공한다고 설명한다.^19 TimeFit은 운영 복잡도가 가장 낮은 Cloud API를 먼저 검증하고, 설치형 엔진은 인증서·보안프로그램 때문에 Cloud 방식이 불가능한 카드사에만 검토한다.

### 7.2 Provider 도입 체크리스트

계약 전:

- 다수 TimeFit 고객사의 법인카드 데이터를 처리할 수 있는 재판매/재위탁 범위
- 카드사별 지원 인증 방식과 실제 성공률
- 승인·취소·부분취소·매입 field sample
- 카드 목록에서 전체 PAN 대신 안정적 provider card ID 제공 여부
- 카드사별 최대 조회기간·페이지·호출 제한
- 데이터 비보관 주장과 로그/백업/장애 분석 데이터의 실제 보존정책
- schema 변경 통지와 장애 SLA

기술 검증:

- 테스트베드 fixture가 아닌 Pilot 고객 sandbox/운영 검증 가능 여부
- 동일 조회 3회 시 event ID 안정성
- 부분취소와 원승인 연결 필드
- 카드 재발급/해지 상태
- 401, 429, 5xx 오류 코드 구분
- 한 카드 실패가 다른 카드 동기화를 막지 않는지

비용 검증:

- 로그인/보유카드/페이지 호출 각각 TR 과금 여부
- 데이터가 없는 조회도 과금되는지
- 테스트와 재시도 과금
- 카드사별 추가비와 최소 계약기간
- 회사 10/100/1,000개에서 카드당 월 원가

### 7.3 현재 TimeFit 코드 검토

현재 `hyphen-card-provider.js`는 OAuth token, 암호화된 인증정보, 보유카드와 거래 normalizer의 골격을 갖고 있다. 그러나 상용 연결 완료로 볼 수 없는 이유는 다음과 같다.

- 실제 법인카드 상품 endpoint가 환경변수 placeholder다.
- 인증 payload가 `cardCompanyCode`, `businessNumber`, `loginMethod` 수준의 범용 필드다.
- 카드사별 인증서/ID/PW/추가 인증 schema가 반영되지 않았다.
- `cardNo`가 `providerAssetId` fallback으로 사용되어 전체 PAN 저장 가능성이 있다.
- 취소·부분취소·매입의 실제 응답 fixture가 없다.
- Provider 계약상 데이터 처리·재위탁 범위를 확인하지 않았다.

### 7.4 2번 전략 판정

**승인하되 “하이픈 단일 종속”은 금지한다.** 하이픈은 MVP 속도를 높이는 가장 현실적인 후보지만, TimeFit 내부 모델은 `hyphen`이 아니라 `provider connection`을 중심으로 유지한다.

계약 조건:

1. 전체 카드번호를 TimeFit으로 보내지 않거나, 수신 즉시 비가역 최소화 가능
2. 다수 고객사 서비스 이용 권한 명시
3. 취소·매입 데이터의 의미와 식별자 안정성 확인
4. 고객 연결 해제 시 인증정보 폐기 증빙
5. CSV 대사와 장애 시 데이터 재조회 허용

## 8. 자체 Connector 검토 — 기존 우선순위 4번

### 8.1 자체 Connector가 의미하는 것

자체 Connector는 단순 REST adapter가 아니다. 카드사 홈페이지 로그인, 공동인증서/업무용 인증서, 키보드 보안, CAPTCHA/추가인증, 세션 유지, 화면·응답 schema 추적, 다운로드 자동화와 장애 관제를 카드사별로 운영하는 제품이다.

필요 구성:

- 카드사별 인증 adapter
- 단기 실행 격리 browser/runtime
- 인증서·비밀번호 Vault와 credential broker
- IP 정책, device binding, 보안프로그램 대응
- DOM/network schema fingerprint와 변경 탐지
- CAPTCHA/추가인증 시 사용자 handoff
- 카드사별 rate limiter와 kill switch
- 합성 모니터, fixture replay, 장애 당직
- 약관·법률·카드사 협의 기록

### 8.2 법률·계약 검토

신용정보법은 허가 없이 신용정보업 또는 본인신용정보관리업을 영위할 수 없다고 규정한다.^20 법인카드 데이터만 다루는 서비스가 구체적으로 어떤 허가·신고 범위에 해당하는지는 고객 유형, 데이터 주체, 이용 목적과 제공 구조에 따라 별도 법률 의견이 필요하다. 법인개별카드나 개인사업자 카드가 포함되면 개인신용정보 문제가 더 커질 수 있다.

자체 Connector 착수 전 최소한 다음 질문에 서면 답변이 있어야 한다.

- 고객의 위임으로 카드사 사이트를 자동 조회하는 것이 해당 카드사 약관과 계약상 허용되는가
- TimeFit이 신용정보회사/본인신용정보관리업/전자금융업 등에 해당하는가
- 법인공용카드와 임직원 명의 법인개별카드의 법적 처리 차이
- 로그인 자격정보와 공동인증서의 수탁 보관 가능 범위
- 고객 데이터의 제3자 제공과 처리위탁 중 어느 구조인가
- 카드사별 사전 협의나 접근 허가가 필요한가

### 8.3 기술·운영 비용

자체 Connector 한 곳의 최초 개발보다 유지보수가 더 비싸다. 카드사 로그인이나 보안 모듈 변경은 사전 통지 없이 장애를 만들 수 있고, 성공률이 낮아지면 고객 전체의 결산이 동시에 지연된다. 카드사별로 개발·QA·운영 책임자가 필요하며, 야간 점검과 월말 트래픽을 고려해야 한다.

개략적인 내부 추정:

| 단계 | 카드사 1곳 예상 | 포함 범위 |
| --- | ---: | --- |
| 사전 타당성 | 2~4주 | 약관/인증/화면/데이터 조사 |
| 최초 구현 | 4~8주 | 로그인·카드·승인·취소·다운로드 |
| Pilot 안정화 | 4주 이상 | 실계정 변형·재인증·대사 |
| 상시 유지 | 월 0.2~0.5 FTE/카드사 | 변경 대응·장애·fixture |

이는 계약·법률 대기와 공동인증서용 설치형 프로그램 개발을 제외한 추정이다. 장치 Connector가 필요하면 코드 서명, 자동 업데이트, OS 호환성과 고객 PC 지원이 추가된다.

### 8.4 Go/No-Go 기준

다음 조건을 모두 만족할 때만 카드사 한 곳에 대한 자체 Connector를 승인한다.

- 공식 ERP/EDI와 2개 이상 전문 Provider가 해당 요구를 지원하지 않음
- 유료 고객 수요가 최소 10개 회사 또는 명확한 연간 계약가치로 확인됨
- 카드사 약관·법률 검토 결과 허용 가능
- 고객 인증정보 책임과 사고 비용을 감당할 보안체계 확보
- 2명의 유지보수 가능 인력과 장애 당직 확보
- CSV 폴백이 이미 운영 중
- 카드사 화면 변경 시 즉시 차단할 kill switch 존재

다음 중 하나면 No-Go다.

- CVC 또는 카드 결제 비밀번호 저장이 필요함
- CAPTCHA/추가인증을 우회해야 함
- 카드사 접근 허용 여부가 불명확한 상태에서 상용 배포
- 카드 전체번호가 일반 애플리케이션 DB/로그를 통과함
- 한 고객 요구만으로 카드사 전용 엔진을 영구 운영해야 함

### 8.5 4번 전략 판정

**현 단계에서는 보류한다.** 자체 Connector를 제품 로드맵에서 삭제할 필요는 없지만, MVP 또는 첫 유료 출시 일정에는 포함하지 않는다. 먼저 공식 EDI, Provider 2곳 견적, CSV 수요를 검토한 뒤 지원 공백과 매출 기회가 유지비를 넘을 때 별도 프로젝트로 승인한다.

## 9. 권장 TimeFit 수집 아키텍처

```text
Official EDI/API ─┐
Provider API ─────┼─> Source Adapter ─> Quarantine/Validation
CSV/XLSX Upload ──┤                         │
Email Candidate ──┘                         v
                                  Immutable Card Event
                                            │
                                  Transaction Grouper
                                            │
                                     Expense Ledger
                                            │
                                  Receipt / Review / Closeout
```

모든 source는 다음 공통 필드를 생성한다.

```text
organization_id
source_type / source_connection_id
issuer_code / provider_asset_token / last4
provider_event_id / idempotency_key
event_type / occurred_at / amount / currency
approval_number / original_event_reference
merchant / acquisition_state
source_received_at / schema_version / confidence
```

동일 거래가 API, CSV, 이메일 세 곳에서 들어올 수 있으므로 source별 event를 지우지 않고 transaction group에서 하나의 경제적 거래로 합친다. 우선순위는 `공식 매입/청구 > 공식 승인 > Provider 매입 > Provider 승인 > CSV > 이메일 candidate`로 두되, 실제 데이터 품질 측정 후 조직별 override를 허용한다.

## 10. 단계별 개발계획

### Phase A — CSV와 공통 Source 모델, 3주

- source connection과 import batch 모델
- CSV/XLSX parser sandbox
- 카드사 template registry
- mapping preview, encoding/date/amount 추정
- PAN 최소화와 file hash/row fingerprint
- 일별 control total과 오류 리포트
- 기존 immutable event/ledger 연결

완료 기준:

- 삼성/현대/KB 중 Pilot 고객이 제공한 실제 파일 3종 적재
- 동일 파일과 중첩 기간 파일 재업로드 시 중복 0건
- 승인·취소 순액이 카드사 화면 합계와 일치

### Phase B — Provider 2번 검증, 3~5주

- Hyphen 계약/RFP 체크리스트 회신
- endpoint와 카드사별 auth schema 확정
- `cardNo` ID fallback 제거
- 보유카드, 승인, 취소, 매입 adapter fixture
- 90일 백필과 증분 cursor
- 사용량·비용·오류 metric
- CSV 병행 대사

완료 기준:

- Pilot 카드 30일 데이터 일별 순액 100% 일치
- 재인증/429/5xx/schema 변경 테스트 통과
- 카드당 월 예상 원가 산출

### Phase C — 이메일 보조 채널, 2~3주

- 회사별 opaque inbound address
- SPF/DKIM/DMARC와 malware 결과 처리
- raw MIME 격리 저장·자동 삭제
- 1개 카드사 template parser
- API/CSV 거래 matching과 candidate UI
- template 변경 경보

완료 기준:

- 위조/중복/전달 이메일이 원장 금액을 변경하지 않음
- 지원 template의 승인 알림이 담당자 요청을 생성
- 원문·PAN 자동 삭제와 감사 로그 확인

### Phase D — 공식 ERP/EDI Pilot, 계약 후 4~8주

- 카드사/중계사 전송 프로토콜 adapter
- mTLS/VPN/SFTP/webhook 보안 설정
- delivery sequence/checksum/control total
- 재전송과 acknowledgement
- 공식 데이터와 Provider event source 우선순위
- 고객 신청·해지 workflow

완료 기준:

- 공식 전송과 카드사 월 명세서 합계 일치
- 누락 delivery 재전송과 중복 수신 검증
- Provider 중단 후 공식 source로 전환 가능

### Phase E — 자체 Connector 타당성, 개발 전 2~4주

- 지원 공백 기관과 유료 고객 수요 집계
- 공식/Provider 2개 이상 거절 또는 미지원 증빙
- 카드사 약관·법률 의견
- 인증 POC와 보안 위협모델
- 12개월 TCO와 매출 비교
- Go/No-Go 위원회 승인

No-Go이면 코드 개발을 하지 않고 CSV/이메일 UX를 개선한다.

## 11. 90일 실행안

| 기간 | 제품/개발 | 사업/외부 |
| --- | --- | --- |
| 1~2주 | 공통 source 모델, CSV fixture, PAN 제거 | Hyphen·쿠콘·카드사 RFP 발송 |
| 3~4주 | CSV mapping/import/dedup | Pilot 회사 데이터 신청 |
| 5~6주 | Hyphen auth/card/events contract | 상품 단가·권한·법무 검토 |
| 7~8주 | 90일 백필, 취소/매입 합성 | 실계정과 CSV 대사 |
| 9~10주 | 이메일 전용주소와 candidate | 카드사 알림 전달 설정 |
| 11~12주 | 운영 metric·재인증·장애 복구 | 공식 EDI Pilot 결정 |

90일 종료 시 선택지는 다음과 같다.

- Provider 품질과 원가가 적합: Provider + CSV로 Closed Beta
- 공식 EDI 계약이 준비됨: 공식 adapter를 병행 개발
- Provider 품질이 부적합: 쿠콘 등 2차 Provider 비교
- 지원 공백이 있으나 수요 부족: CSV/이메일 유지, 자체 Connector 보류
- 지원 공백과 충분한 매출이 확인됨: 자체 Connector 타당성 Phase E 시작

## 12. 의사결정 매트릭스

각 카드사/수집원마다 100점으로 평가한다.

| 항목 | 가중치 | 판단 기준 |
| --- | ---: | --- |
| 승인·취소·매입 완전성 | 25 | 부분취소·원승인·지연 매입 포함 |
| 법적·계약 명확성 | 20 | 다고객 SaaS 처리 권한과 위탁 구조 |
| 안정성·재전송 | 15 | SLA, cursor, replay, schema 통지 |
| 보안 책임 | 15 | PAN/credential 최소화 가능성 |
| 카드사 범위 | 10 | Pilot 및 목표 고객 커버리지 |
| 총소유비용 | 10 | 개발+호출+장애+지원 비용 |
| 도입 속도 | 5 | 운영 데이터 첫 수신까지 기간 |

- 80점 이상: 주 수집원 후보
- 65~79점: 보조 수집원 또는 조건부 Pilot
- 50~64점: CSV 대체가 없는 기관만 제한 검토
- 50점 미만: 도입하지 않음

## 13. 최종 권고

### 즉시 실행

1. CSV/XLSX import와 대사 기능을 첫 개발로 확정한다.
2. Hyphen에 법인카드 상품 명세·다수 고객사 이용권한·실제 단가를 요청한다.
3. 동시에 쿠콘 법인카드 EDI와 Pilot 고객의 주 카드사에 공식 ERP 연계 RFP를 보낸다.
4. 현재 Hyphen adapter의 전체 카드번호 fallback을 제거한다.
5. 이메일은 회사별 전용 주소 방식으로 한 카드사만 작은 Pilot을 한다.

### 하지 않을 일

- 공개 API 포털이 있다는 이유만으로 법인 지출 조회가 즉시 가능하다고 가정하지 않는다.
- 이메일 알림을 월 결산의 유일한 데이터 원천으로 사용하지 않는다.
- 전체 Gmail mailbox scope를 MVP에서 요청하지 않는다.
- 카드사 웹 스크래핑을 고객 한 곳의 요구만으로 개발하지 않는다.
- 전체 PAN·CVC·카드사 비밀번호를 일반 DB에 보관하지 않는다.

### 제품 포지션

TimeFit의 핵심 자산은 카드사 로그인 기술이 아니라, 여러 수집원의 거래를 회사별로 안전하게 합치고 직원·영수증·프로젝트·계정과목·결산으로 연결하는 업무 모델이다. 수집망은 교체 가능해야 하고, 지출 원장과 고객 업무 이력은 Provider가 바뀌어도 유지되어야 한다.

## 14. Sources

1. 현대카드. “[ERP 연계서비스 신청](https://mycompany.hyundaicard.com/as/at/ASAT1001.do?_method=x&chk=12).” 접속 2026-09-11.
2. 하나카드. “[기업카드 통합관리 서비스](https://www.hanacard.co.kr/jsp/OCS10000000N.web?mID=OCS10000000N&schID=ccd).” 접속 2026-09-11.
3. KB금융그룹. “[KB Group Open API Portal](https://apiportal.kbfg.com/).” 접속 2026-09-11.
4. BC카드. “[BC OPEN API 명세서](https://www.bccard.com/OpenAPI/APIspec.html).” 접속 2026-09-11.
5. 삼성카드. “[Ez-Work 서비스](https://www.samsungcard.com/corporation/services/ez-work/UHPCBE0101M0.jsp).” 접속 2026-09-11.
6. 쿠콘. “[국내 법인카드 EDI](https://www.coocon.net/dataService_corpData.act).” 접속 2026-09-11.
7. 삼성카드. “[삼성카드 법인](https://www.samsungcard.com/corporation/main/UHPCCO0101M0.jsp).” 접속 2026-09-11.
8. 삼성카드. “[법인카드 일괄 한도 변경](https://www.samsungcard.com/corporation/card/change-limit/period/UHPCMM0224M0.jsp).” 접속 2026-09-11.
9. 삼성카드. “[법인사업자 신규 법인카드 신청](https://www.samsungcard.com/corporation/card/cor-biz-card/UHPCCA0211M0.jsp).” 접속 2026-09-11.
10. 현대카드. “[현대카드 비즈플레이](https://mycompany.hyundaicard.com/as/at/ASAT1001.do?_method=x&chk=16).” 접속 2026-09-11.
11. Amazon Web Services. “[Email receiving with Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/receiving-email.html).” 접속 2026-09-11.
12. Amazon Web Services. “[Amazon SES email receiving concepts](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html).” 접속 2026-09-11.
13. Google. “[Configure push notifications in Gmail API](https://developers.google.com/workspace/gmail/api/guides/push).” 접속 2026-09-11.
14. Google. “[Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).” 접속 2026-09-11.
15. PCI Security Standards Council. “[Are entities allowed to request cardholder data over end-user messaging technologies?](https://www.pcisecuritystandards.org/faqs/1310/).” 2025-08.
16. PCI Security Standards Council. “[Why is storage of sensitive authentication data after authorization not permitted?](https://www.pcisecuritystandards.org/faqs/1533/).” 접속 2026-09-11.
17. 하이픈. “[법인카드 조회](https://www.hyphen.im/product/view?seq=55).” 접속 2026-09-11.
18. 하이픈. “[OAuth 2.0 및 API 사용 안내](https://hyphen.im/product-api/view?seq=36).” 접속 2026-09-11.
19. 하이픈. “[API·Local Scraping·Server Scraping 안내](https://hyphen.im/product-recommended-package/v1).” 접속 2026-09-11.
20. 국가법령정보센터. “[신용정보의 이용 및 보호에 관한 법률 제4조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1026815221).” 시행 2026-08-13.
