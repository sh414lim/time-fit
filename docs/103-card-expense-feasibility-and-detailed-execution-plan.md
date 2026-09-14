# TimeFit 카드·지출관리 실현 가능성 검토 및 상세 실행계획

## 1. 최종 판단

**조건부로 실현 가능하다.** 현재 TimeFit에는 조직, 멤버십, 카드 연결, 카드 자산, 동기화 실행, 거래 이벤트, 지출 원장, 영수증, 예외 검토, 결산과 보고서의 골격이 이미 있다. 따라서 제품 전체를 새로 만드는 사업이 아니라, 기존 골격을 멀티테넌트 상용 수준으로 강화하고 실제 금융 데이터 Provider 한 곳을 붙이는 사업으로 판단한다.

기술 구현 가능성은 높지만 실제 카드 내역 자동 조회의 일정은 코드보다 Provider 계약·상품 권한·테스트 계정·카드사별 인증 방식에 더 크게 좌우된다. 다음 세 조건을 충족하기 전에는 상용 출시로 판정하지 않는다.

1. 조직 A의 인증으로 조직 B 금융 객체에 접근할 수 없다는 자동 검증
2. 전체 카드번호·CVC·인증 비밀이 일반 DB와 로그에 저장되지 않는 구조
3. 실제 Provider 데이터와 카드사 CSV를 이용한 30일 이상 대사에서 중복·누락·오합산 0건

## 2. 범위별 실현 가능성

| 영역 | 가능성 | 현재 준비도 | 핵심 난점 | 판정 |
| --- | ---: | ---: | --- | --- |
| 여러 회사 가입·분리 | 높음 | 70% | 금융 전용 권한과 교차 조직 테스트 | 바로 착수 가능 |
| 카드 연결 UI | 높음 | 65% | Provider별 인증 필드 차이 | 계약 명세 후 확정 |
| 보유카드 자동 발견 | 중상 | 45% | Provider 상품 권한·응답 규격 | Provider 의존 |
| 승인·취소·매입 수집 | 중상 | 50% | 부분취소·지연 매입·페이지 재개 | Pilot 대사 필수 |
| 직원 지정·사유·영수증 | 높음 | 65% | 적용 시작일과 알림 정책 | 기존 기능 재사용 |
| 자동 계정과목 분류 | 높음 | 55% | 오분류 책임과 신뢰도 기준 | 규칙 기반부터 시작 |
| 월 결산·보고서 | 높음 | 60% | 확정 후 늦은 취소 처리 | 조정분 모델 필요 |
| 자체 카드사 스크래핑 | 낮음 | 10% | 약관·보안·화면 변경·운영비 | 1차 범위 제외 |
| 개인카드 통합 조회 | 낮음 | 10% | 신용정보·MyData 규제 검토 | 별도 사업으로 분리 |

종합 준비도는 약 **55~60%**로 본다. UI와 원장 기능은 상당 부분 존재하지만, 고객에게 판매 가능한 상태를 결정하는 보안·Provider 실연동·대사·운영 체계는 아직 절반 이하이다.

## 3. 현재 코드 기준 Gap 분석

### 3.1 재사용할 부분

- `timefit_user_organizations`, `timefit_user_memberships`: 회사와 사용자 소속 기반
- 카드 connection·asset·sync run·cursor: 연결 및 동기화 상태 모델
- immutable card event·transaction group: 승인/취소 원본과 합성 거래 구조
- expense·source·match·audit: 지출 원장과 증빙 연결
- 영수증 OCR, 중복 검증, 검토 화면
- 예외함, 리마인드, 결산, 보고서 API와 화면
- mock Provider와 Hyphen adapter factory

### 3.2 출시 전 반드시 수정할 부분

| 우선순위 | 문제 | 현재 증거 | 조치 |
| --- | --- | --- | --- |
| P0 | 전체 카드번호 저장 가능성 | Hyphen normalizer가 `cardNo`를 `providerAssetId` fallback으로 사용 | Provider 고유 ID만 허용하거나 카드번호를 서버 HMAC으로 토큰화하고 원문 즉시 폐기 |
| P0 | 금융 권한이 manager 하나에 집중 | `_finance-server.js`가 manager 여부 위주로 판정 | finance permission 테이블과 공통 authorize 함수 도입 |
| P0 | 조직 참조 무결성 부족 가능성 | 각 테이블에 `organization_id`는 있으나 모든 FK 조합 보장 필요 | 복합 FK/RPC 검증과 API object ownership 공통 검사 |
| P0 | 인증정보를 암호문으로 일반 DB에 저장 | connection의 encrypted credential reference 사용 | Pilot은 envelope encryption, 상용은 Vault reference로 전환 |
| P1 | Hyphen 경로·payload가 골격 | 환경변수 endpoint와 범용 필드만 존재 | 계약 명세 기반 adapter와 contract fixture 작성 |
| P1 | Serverless 장기 작업 한계 | Vercel API 함수 중심 | 짧은 page job으로 분할하거나 별도 worker 도입 |
| P1 | Provider별 동시성 제어 부족 | cursor/run은 있으나 분산 lock·quota 정책 보완 필요 | advisory lock/queue와 retry budget 도입 |
| P2 | 운영 가시성 부족 | 고객 UI 중심 | 운영자용 익명 장애 현황, 비용, 지연, schema 오류 화면 추가 |

## 4. 목표 MVP와 출시 제외선

### MVP에 포함

- 회사별 독립 계정과 금융 권한
- Provider 1개, 우선 카드사 1~2개
- 법인카드 보유 목록과 last4 표시
- 최대 90일 백필 및 정기 증분 동기화
- 승인·전체취소·부분취소·매입 표준화
- 카드 담당 직원 지정
- 직원 사유·영수증·프로젝트·태그 제출
- 미증빙·중복·금액 불일치·동기화 실패 예외함
- CSV 폴백과 일별 대사
- 월 결산 및 Excel/PDF 보고서
- 연결 해제, 재인증, 감사 로그

### MVP에서 제외

- 자체 스크래핑 엔진
- 모든 카드사 동시 지원
- 개인 소비자 카드
- 송금·결제·카드 제어
- 전체 카드번호 및 CVC 보관
- AI 단독 자동 세무 판정
- 외부 개발자용 금융 API 판매

## 5. 선행 의사결정과 외부 의존성

개발은 시작할 수 있지만 다음 항목은 늦어도 Sprint 1 종료 전 확정해야 한다.

| 결정 | 권장 기본값 | 미확정 시 영향 | 책임자 |
| --- | --- | --- | --- |
| 첫 고객군 | 다매장 외식업 법인 | 화면·권한 범위 흔들림 | 제품 책임자 |
| 첫 Provider | 공식 API 우선, 불가 시 Hyphen | 실제 연동 Sprint 차단 | 사업/기술 |
| 첫 카드사 | Pilot 고객 사용량이 가장 큰 1개 | 테스트 계정 확보 지연 | Pilot 고객 |
| 사업자 범위 | 법인 우선 | 개인사업자 법률 범위 확대 | 사업/법무 |
| 동기화 주기 | 30~60분, 야간 보정 1회 | 호출 원가·신선도 변화 | 제품/운영 |
| 원본 응답 | 최소 필드만 단기 암호화 보관 | 장애 분석과 개인정보 부담 간 충돌 | 보안/법무 |
| 자동 분류 | 추천만, 관리자 확정 | 초기 오분류 위험 감소 | 제품 |
| 결산 정책 | 확정본 불변, 이후 조정분 생성 | 회계 신뢰성 | 제품/회계 |

외부 의존 작업은 개발과 병렬로 즉시 시작한다.

1. Provider NDA·상품 신청·견적·재위탁 조건 확인
2. 보유카드/승인/취소/매입 endpoint와 sandbox 계정 확보
3. Pilot 회사의 카드사 CSV 90일분과 테스트 카드 확보
4. 개인정보 처리방침, 위탁/재위탁, 보존·파기 문구 검토
5. 장애 연락 채널과 Provider SLA 확인

## 6. 상세 개발 진행계획

### Stage 0 — 착수 준비 및 계약 트랙, 1~2주(개발과 병렬)

목표: 실제 연동의 불확실성을 문서와 테스트 자료로 제거한다.

작업:

- Provider 기능표 작성: 카드사, 인증 방식, 지원 조회, 조회 기간, 취소/매입 지원
- API 명세, 오류 코드, rate limit, sandbox/운영 URL 확보
- Pilot 회사·카드·담당자·CSV 기준 데이터 확정
- 개인정보 항목별 수집 목적·보존기간·파기 방식 데이터맵 작성
- 성공 기준과 중단 기준 서명

산출물:

- Provider contract pack
- Pilot test dataset
- 개인정보 처리 데이터맵
- Go/No-Go 체크리스트

완료 기준:

- 보유카드와 승인내역을 sandbox에서 최소 1회 조회할 수 있음
- 실데이터 대사 담당자와 기준 CSV가 지정됨

### Stage 1 — 멀티테넌트 보안 기반, 2주

목표: 어느 기능을 추가해도 회사 간 금융정보가 섞이지 않는 기반을 만든다.

백엔드/DB:

- `finance_permissions` 또는 membership capability 모델 추가
- `finance.connection.manage`, `finance.expense.review`, `finance.expense.submit`, `finance.report.read`, `finance.closeout.manage` 정의
- 모든 finance API가 공통 `authorizeFinance()`를 사용하도록 변경
- organization과 참조 객체가 동일한지 검증하는 공통 함수/RPC 추가
- Storage path를 `organization_id/...`로 강제하고 policy 테스트 추가
- 자격정보 접근/교체/폐기 감사 이벤트 추가

보안:

- Hyphen 카드 식별 fallback에서 원본 `cardNo` 제거
- Provider ID가 없으면 `HMAC(issuer + normalized PAN)`으로 일회성 식별자를 생성하고 PAN은 저장·로그하지 않음
- API 오류 body, console, telemetry의 secret redaction 테스트
- 서비스 역할 키를 사용하는 endpoint의 사용자·조직 재검증

테스트:

- 조직 A/B, 소유자/비용관리자/직원/조회자 fixture
- RLS, REST API, Storage, 캐시 회사 전환 E2E
- IDOR(object ID 바꿔치기) 테스트

완료 기준:

- 교차 조직 읽기·쓰기·파일 접근 테스트 100% 차단
- 전체 PAN·비밀번호·인증서가 DB/로그 fixture에 0건
- 역할별 허용/거부 매트릭스 통과

### Stage 2 — Provider 표준 계약과 안전한 자격정보, 2주

목표: Hyphen 외 Provider도 교체 가능한 내부 인터페이스를 고정한다.

개발:

- capability manifest: cards, approvals, cancellations, acquisitions, billing
- 인증 field schema를 adapter가 UI에 제공하도록 변경
- `authenticate`, `listCards`, `fetchEvents`, `refresh`, `disconnect`, `healthCheck` 계약 확정
- 응답 schema version, request ID, usage count, provider cost 기록
- 인증 비밀과 connection metadata 분리
- Pilot 단계 envelope encryption 및 key rotation 절차 구현
- 상용 전 Vault/KMS adapter 경계 정의

테스트:

- Mock과 실제 adapter에 동일 contract suite 적용
- timeout, 401, 403, 429, 5xx, malformed response fixture
- 비밀값 redaction snapshot

완료 기준:

- Provider 변경 시 원장·UI 코드 변경 없이 adapter만 교체 가능
- 오류가 `reauth_required`, `retryable`, `schema_changed`, `fatal`로 일관되게 분류

### Stage 3 — 실제 Provider 1개 및 카드사 1개, 3~5주

목표: 실제 카드 연결부터 90일 내역 대사까지 완주한다.

연결 흐름:

- 카드사와 인증 방식 선택
- 인증 성공 후 보유카드 조회
- 카드사·카드명·last4만 표시
- 수집 카드 선택과 담당 직원 지정
- 중복 connection/card 방지

수집 흐름:

- 기간과 페이지를 작은 job으로 분할
- 조직/Provider/card 단위 분산 lock
- 90일 백필, 중단 지점 재개, overlap 증분 조회
- 승인·취소·부분취소·매입을 immutable event로 저장
- idempotency key와 transaction group 합성
- 카드별 최근 성공 시각·다음 예정·오류 원인 표시

대사:

- CSV import mapping preview
- 날짜별 승인/취소/순액 비교
- 누락, 중복, 상태 차이 리포트
- 차이 원인을 Provider 지연/표준화/데이터 입력으로 분류

완료 기준:

- 동일 범위를 3회 재수집해도 건수·합계 불변
- Pilot CSV와 30일 일별 순액 100% 일치
- 부분취소와 늦은 매입 fixture 전부 통과
- 인증 만료 시 무한 재시도 없이 재인증 화면으로 전환

### Stage 4 — 직원 지출 처리, 2~3주

목표: 카드 결제 이후 증빙 수집을 관리자 수기 연락 없이 끝낸다.

개발:

- 카드 담당자와 적용 시작일/종료일 모델
- 직원별 미제출 거래함
- 사유·프로젝트·태그·영수증 제출
- OCR 결과와 카드 거래 매칭 점수
- 관리자 반려와 보완 요청
- 미제출 리마인드 빈도와 조용한 시간 설정

권한 원칙:

- 직원은 자신에게 배정된 거래만 조회
- 카드 원본 금액·일시·가맹점은 직원이 수정 불가
- 관리자의 담당자 일괄 변경은 변경 범위와 결과를 미리 표시

완료 기준:

- 결제 수집 → 담당자 요청 → 제출 → 관리자 확인 전 과정 E2E 통과
- 같은 영수증 중복 업로드 차단
- 잘못 배정된 거래 재지정 이력 보존

### Stage 5 — 자동화·예외함·결산, 2~3주

목표: 관리자가 정상 건이 아니라 예외 건만 처리하게 한다.

개발:

- 사업자번호 > 정규화 상호명 > 키워드 순 분류 규칙
- 자동 확정이 아닌 신뢰도 기반 추천부터 적용
- 미증빙, 중복 의심, 금액 불일치, 취소 미연결, 수집 지연 예외 통합
- 일괄 분류/승인과 되돌리기
- 월 결산 snapshot과 확정 이후 조정분
- Excel/PDF 버전, 생성자, 생성시각, 기준 데이터 hash 보존

완료 기준:

- 확정 결산 원본이 이후 동기화로 변경되지 않음
- 늦은 취소는 다음 기간 조정 또는 명시적 재오픈으로만 반영
- 보고서 합계와 원장 SQL 합계 일치

### Stage 6 — 운영 안정화와 Closed Beta, 2~3주

목표: 1~3개 실제 회사에서 안전하게 운영한다.

운영:

- Provider 상태, 동기화 지연, 오류율, 호출량, 조직별 원가 dashboard
- schema 변경 kill switch
- 장애 등급과 고객 공지 template
- 재인증, 연결 해제, 회사 삭제 runbook
- 백업 복구 및 credential rotation 훈련
- 고객지원 break-glass 승인·만료·감사 절차

Beta 제한:

- 회사 1~3곳, 카드 30장 이하 권장
- 자동 결산 확정 비활성
- CSV 주간 대사 유지
- 지원 카드사와 알려진 제한을 화면에 명시

완료 기준:

- 2주 연속 중복·오합산·교차 조직 노출 0건
- 동기화 성공률 99% 이상(Provider 계획 점검 제외)
- P0/P1 미해결 결함 0건

## 7. 일정과 인력 시나리오

### 권장 인력

- 제품/업무 설계 0.5명
- 백엔드·DB 1명
- 프런트엔드 1명
- QA/자동화 0.5명
- 보안·인프라 0.3명
- 법무/개인정보 외부 검토 필요 시 별도

한 명이 전부 개발하면 컨텍스트 전환과 QA 병목 때문에 기간이 크게 늘어난다.

| 시나리오 | 조건 | 예상 기간 | 비고 |
| --- | --- | ---: | --- |
| 빠른 Pilot | 2~3명, Provider 명세·sandbox 준비 | 11~14주 | 카드사 1개, 최소 운영 기능 |
| 현실적 권장 | 2명 개발 + 부분 QA/제품 | 14~18주 | Closed Beta 포함 |
| 1인 개발 | 계약 지원 별도, 개발/QA 순차 | 20~28주 | 보안·대사 기간 축소 금지 |
| 계약 지연 | Provider 심사 미완료 | 위 일정 + 대기기간 | Mock/CSV까지만 선행 가능 |

## 8. 주차별 실행안(현실적 권장 시나리오)

| 주차 | 핵심 결과 | 병렬 외부 작업 |
| --- | --- | --- |
| 1 | 권한표·위협모델·두 조직 fixture | Provider 신청, 법무 질문 확정 |
| 2 | RLS/API/Storage 격리, PAN 비저장 | sandbox와 CSV 확보 |
| 3 | Provider interface와 auth schema | 카드사별 필드 확인 |
| 4 | 오류 분류·사용량·credential 경계 | 운영 약관/보존 검토 |
| 5 | 실인증·보유카드 조회 | Pilot 사용자 교육 |
| 6 | 승인 조회와 표준 이벤트 | CSV 기준 데이터 정제 |
| 7 | 취소·부분취소·매입 합성 | 차이 원인 확인 |
| 8 | 90일 백필·재개·증분 동기화 | 1차 대사 |
| 9 | 대사 수정·재인증·연결 해제 | 2차 대사 승인 |
| 10 | 카드 담당자·직원 요청함 | 알림 문구 확인 |
| 11 | 영수증·사유·반려 E2E | 직원 사용성 테스트 |
| 12 | 분류 규칙·예외함 | 회계 담당 검수 |
| 13 | 결산 snapshot·조정분·보고서 | 보고서 양식 승인 |
| 14 | 운영 console·경보·runbook | Beta 계약/지원 준비 |
| 15~16 | Closed Beta와 매일 대사 | 장애·문의 분석 |

## 9. 작업 단위와 완료 정의

모든 개발 티켓은 다음 항목을 포함한다.

- 사용자/운영 목적
- 허용 역할과 거부 역할
- organization 경계
- 입력/출력 schema
- 민감정보와 로그 금지 필드
- 정상/실패/재시도/멱등성 조건
- unit, API, RLS, E2E 테스트
- 모니터링 metric과 감사 이벤트
- rollback 또는 feature flag

공통 Done 기준:

1. 코드 리뷰와 자동 테스트 통과
2. `npm test`와 production build 통과
3. migration forward test 및 가능한 rollback 절차 기록
4. 민감정보 로그 검사 통과
5. Git commit 후 `main` push
6. Git 기반 production 배포
7. 배포 버전과 Git commit 일치 확인
8. smoke test와 핵심 metric 확인

## 10. 출시 게이트

### Gate A — 개발 착수

- 제품 범위와 1차 고객군 확정
- 자체 스크래핑 제외 합의
- 보안 P0 작업 승인

### Gate B — 실 Provider 착수

- 계약/상품 권한/sandbox/명세 확보
- 자격정보 책임 경계 문서화
- Provider contract test fixture 확보

### Gate C — 실제 고객 데이터 사용

- 테넌트 격리 테스트 통과
- PAN·secret 비저장 검증
- 동의·보존·파기 문구 승인

### Gate D — Closed Beta

- 30일 CSV 대사 100% 일치
- P0/P1 결함 0건
- 장애/재인증/연결 해제 runbook 검증

### Gate E — 유료 출시

- 2주 이상 Beta 안정성 충족
- 조직별 호출 원가 측정
- 고객지원과 사고 대응 담당 확정
- 보안·법률 최종 승인

어느 Gate든 실패하면 범위를 늘리지 않고 해당 단계에서 수정한다.

## 11. 주요 위험과 대응

| 위험 | 가능성 | 영향 | 조기 신호 | 대응 |
| --- | ---: | ---: | --- | --- |
| Provider 계약 지연 | 높음 | 높음 | sandbox 미발급 | Mock/CSV 개발 병행, 출시일은 계약 후 재산정 |
| 카드사 응답 변경 | 중간 | 높음 | schema parse 오류 | version 검증, raw 최소 보관, kill switch |
| 중복/오합산 | 중간 | 매우 높음 | CSV 일별 차이 | immutable event, idempotency, 일별 대사 |
| 회사 간 데이터 노출 | 낮음 목표 | 매우 높음 | IDOR 테스트 실패 | 다층 조직 검증, 자동 공격 테스트, 출시 차단 |
| 인증정보 유출 | 낮음 목표 | 매우 높음 | 로그 secret 탐지 | Vault, redaction, 단기 권한, rotation |
| Serverless timeout | 중간 | 중간 | 백필 중단 | page job 분할, queue/별도 worker |
| 호출 원가 급증 | 중간 | 중간 | 카드당 호출 증가 | 증분 cursor, overlap 제한, 조직 quota |
| 직원 미사용 | 중간 | 중간 | 증빙 제출률 저하 | 모바일 우선 요청함, 간단 입력, 단계적 알림 |

## 12. 측정 지표

제품 지표:

- 거래 수집 후 담당자에게 보이기까지의 시간
- 3일 내 증빙 완료율
- 관리자 수동 처리 비율
- 자동 분류 추천 수락률
- 거래 100건당 예외 수
- 월 결산 소요 시간

기술 지표:

- 동기화 성공률과 P95 지연
- 중복 삽입률과 대사 차이율
- Provider별 401/429/5xx 비율
- 재인증 완료 시간
- 조직별 카드 1장당 월 호출량·원가
- 교차 조직 보안 테스트 실패 수(목표 0)

## 13. 즉시 실행 순서

다음 개발은 아래 순서로 시작한다.

1. Hyphen normalizer의 전체 카드번호 fallback 제거
2. finance permission 및 공통 organization 검증 설계
3. 조직 A/B 보안 테스트 fixture와 RLS/API 테스트 작성
4. Provider capability/auth schema 계약 작성
5. 실제 Provider 명세 수령 전까지 Mock/CSV로 event·대사 강화
6. 명세 수령 즉시 adapter contract test와 실연동 진행

가장 먼저 화면을 늘리는 것보다 1~3번을 끝내는 것이 중요하다. 이 기반이 완료되면 기존 카드 연결·지출·영수증 화면을 안전하게 확장할 수 있고, Provider가 바뀌어도 TimeFit의 핵심 업무 기능은 그대로 유지된다.
