# TimeFit 지출·증빙 최종안 실제 구현 가능성 점검

작성일: 2026-09-10  
검토 기준: `docs/70-expense-evidence-final-approved-plan-and-roadmap.md`  
점검 범위: 현재 저장소, DB migration, Vercel 환경, 외부 연동 준비, 빌드, 테스트·운영 제약

## 1. 최종 판정

**기술적으로 구현 가능하다. 현재 환경도 재사용할 수 있다. 그러나 지금 즉시 전체 기능이 작동하는 상태는 아니며, 외부 권한과 핵심 데이터 구조 변경 없이는 법인카드 자동조회와 OCR을 완료할 수 없다.**

판정:

- 설계 구현 가능성: 높음
- 현재 코드 기반 재사용성: 중상
- 현재 목표 기능 구현률: 초기 기반 수준
- 내부 개발 즉시 착수: 가능
- 실제 카드 자동연결 검증: 하이픈 권한 확보 전 불가
- 실제 OCR 운영 검증: Google Cloud 자격증명 확보 전 불가
- 현재 상태의 제품 출시: 불가

## 2. 확인한 사실

### 빌드

`npm run build`를 실행했고 Vite 프로덕션 빌드가 성공했다.

- React/Vite 모듈 118개 변환 성공
- JS bundle 약 359.55KB, gzip 약 108.65KB
- CSS 약 107.47KB, gzip 약 20.15KB
- 빌드 오류 없음

따라서 현재 앱을 기반으로 기능을 확장하는 것은 가능하다.

### 현재 운영 환경변수

Vercel Production에 존재하는 키:

- Supabase URL/anon key/service role
- Toss Place merchant/access key/secret
- integration encryption key
- cron secret

존재하지 않는 필수 키:

- HYPHEN_USER_ID/HKEY/base URL/environment
- Google Vision project/credential
- LLM API key/model
- card sync 전용 cron secret/retention policy

현재 로컬 `.env.local`에는 Vercel OIDC token 이름만 확인된다. 민감한 값 자체는 조회하지 않았다.

### 현재 코드 기반

재사용 가능한 기능:

- Supabase Auth와 조직 membership
- 조직별 RLS helper와 관리자 권한 패턴
- 비공개 finance document Storage bucket
- signed URL 문서 조회
- 카드 메타데이터 수동 등록
- CSV 카드 거래 가져오기와 기초 중복 index
- Toss Place 매출 동기화와 dashboard API
- 급여·실제 근태 데이터
- Vercel Cron
- AES-256-GCM 서버 비밀 암호화 유틸리티

현재 존재하지 않는 기능:

- 하이픈 provider adapter
- 카드사 인증/동의/재인증
- 보유카드 자동조회·등록
- 승인·매입 증분 동기화 worker
- Google Vision/LLM 처리 API
- 촬영 전용 직원 화면
- 카드·영수증 매칭
- 단일 지출 원장
- closeout snapshot
- 순익 chart API
- PDF/Excel/ZIP 보고서 worker
- 자동화 테스트 runner/E2E suite

## 3. 기능별 구현 가능성

| 기능 | 구현 가능 | 현재 기반 | 차단 요소 | 판정 |
|---|---:|---|---|---|
| 카드 수동 등록 | 예 | 구현됨 | 명칭/삭제 정책 | 수정 필요 |
| CSV 내역 수집 | 예 | 기초 구현 | 카드사별 매핑·부분취소 | 즉시 개발 가능 |
| 하이픈 자동 연결 | 예 | 서버 암호화 패턴 | 계약·키·실제 명세 | 외부 권한 필요 |
| 보유카드 자동 등록 | 예 | 카드 테이블 | provider 카드 ID | 하이픈 필요 |
| 승인 자동조회 | 예 | Cron/API 패턴 | 호출 API·작업 큐 | 하이픈 필요 |
| 취소·부분취소·매입 | 예 | 단순 승인/취소 | event/group DB | 구조 변경 필요 |
| 영수증 촬영 | 예 | React 반응형·Storage | 전용 UX·이미지 처리 | 즉시 개발 가능 |
| Google Vision OCR | 예 | 서버 함수 패턴 | GCP project/credential | 외부 설정 필요 |
| LLM JSON 구조화 | 예 | Supabase config 힌트 | 운영 키·모델·API | 외부 설정 필요 |
| 카드·영수증 매칭 | 예 | 카드/문서 데이터 | 지출 원장·후보 모델 | 구조 변경 필요 |
| 중복 방지 | 예 | CSV unique index | 복수 원천 멱등 모델 | 구조 변경 필요 |
| 일·주·월 보고 | 예 | 매출·급여 원천 | closeout 집계 DB/API | 즉시 개발 가능 |
| 운영순익 차트 | 예 | React UI·매출 API | 공통 집계 endpoint | 즉시 개발 가능 |
| PDF 보고서 | 예 | 일정 PDF 패턴 | 서버 렌더러/worker | 추가 개발 필요 |
| Excel/ZIP | 예 | CSV/메일 패턴 | 생성 library·비동기 작업 | 추가 개발 필요 |
| 마감·재오픈 | 예 | 월말 일부 정책 | snapshot/version 모델 | 구조 변경 필요 |

## 4. 현재 스키마의 주요 문제

### 카드 식별

현재 `unique (organization_id, issuer, last4)`는 같은 카드사의 동일 끝4자리 카드가 존재할 경우 충돌한다. 실제 연동에서는 `(organization_id, provider, provider_card_id)`를 고유 기준으로 사용해야 한다.

### 거래 상태

현재 거래 유형은 `approval`, `cancellation`만 지원하고 금액은 음수가 될 수 없다. 부분취소, 매입, 청구, 해외 원화 확정액을 표현하기 어렵다. immutable event와 current transaction group으로 분리해야 한다.

### 카드 삭제

현재 카드가 삭제되면 카드 거래도 `on delete cascade`로 삭제된다. 이는 연결 해제 후에도 과거 지출·결산을 보존한다는 최종 기획과 충돌한다.

필수 변경:

- UI의 `삭제`를 `연결 해제/보관`으로 변경
- card 상태를 disconnected로 전환
- credential reference 파기
- 과거 event/group/expense/closeout 유지
- 법적 보존기간 종료 후 별도 파기 절차

### 브라우저 직접 쓰기

현재 CSV 거래는 인증된 브라우저 클라이언트가 DB에 upsert한다. 실제 카드 API, OCR, 지출 확정은 서버에서 권한·멱등성·감사 로그를 검증한 뒤 기록해야 한다.

## 5. 런타임·배포 적합성

### Vercel Functions

짧은 연결 API와 화면 조회에는 적합하다. 그러나 현재 함수 설정의 최대 실행시간은 10~60초다. 90일 카드 백필, 대량 OCR, PDF/ZIP 생성은 한 요청에서 완료하면 timeout 위험이 크다.

권장 구조:

```text
API 요청
→ DB job 생성
→ Cron/worker가 작은 구간 claim
→ 결과/커서 저장
→ 다음 구간 예약
→ UI polling 또는 realtime 상태 갱신
```

### Cron

현재 일 단위 Cron은 이미 사용 중이다. 카드의 1시간/6시간 동기화를 추가할 수 있지만 Vercel 요금제의 Cron 빈도·실행량과 하이픈 호출비용을 실제 계약 전에 확인해야 한다.

### Supabase

원장, RLS, 작업 큐, snapshot에는 적합하다. DB advisory lock 또는 `FOR UPDATE SKIP LOCKED` 형태의 job claim을 사용할 수 있다.

원격 migration 상태 확인은 이번 점검 환경에서 DNS 연결과 DB password 입력 단계 때문에 완료하지 못했다. 로컬 migration 파일 존재와 이전 적용 기록은 확인됐지만, 개발 시작 전 운영 DB의 실제 migration 상태를 다시 확인해야 한다.

## 6. 코드 구조 적합성

현재 주요 파일 규모:

- `src/main.jsx`: 1,227줄
- `src/lib/supabase.js`: 548줄

기능을 그대로 추가하면 카드, 영수증, 결산 로직이 단일 파일에 집중된다. 구현 전에 최소한 다음 구조로 분리하는 것이 필요하다.

```text
src/features/expenses/
src/features/receipts/
src/features/cards/
src/features/closeouts/
src/lib/api/
src/lib/finance/
api/cards/
api/receipts/
api/closeouts/
api/providers/hyphen/
```

전체 앱을 재작성할 필요는 없다. 기존 화면을 유지하면서 지출·증빙 기능만 feature module로 추출한다.

## 7. 데이터 원천 구현 가능성

### 매출

기존 Toss Place 연동과 일별 sales cache/API가 있어 재사용 가능하다. 다만 주문일, 취소일, 정산일을 구분하고 영업일 cutoff를 결산 정책에 적용해야 한다.

### 인건비

스케줄, 출퇴근, 계약, 급여 draft가 있어 예상/실제 인건비를 계산할 수 있다. 일간에는 출퇴근 기반 추정, 월마감에는 확정 급여 안분을 권장한다.

### 지출

카드와 finance document는 있으나 확정 지출 원장이 없다. 카드 거래와 영수증을 직접 합산하지 않고 `expenses`를 신규 중심 원장으로 만들어야 한다.

따라서 운영순익 구현 자체는 가능하지만 지출 원장을 먼저 구축해야 숫자의 중복과 변경 이력을 통제할 수 있다.

## 8. 보고·차트·파일 생성 가능성

### 집계

PostgreSQL 함수 또는 materialized/cache table로 일·주·월·연 집계가 가능하다. 화면, 차트, PDF, Excel이 동일한 집계 결과와 snapshot version을 사용해야 한다.

### 차트

현재 chart library는 설치되어 있지 않다. Recharts/ECharts 등 하나를 선택해야 한다. 의존성 추가 없이 SVG로도 가능하지만 8개 차트와 접근성·툴팁·반응형을 고려하면 검증된 라이브러리가 효율적이다.

### PDF·Excel

현재 스케줄 PDF 출력 패턴과 Python 문서 생성 스크립트가 있으나 운영용 결산보고서 worker는 없다. 서버 런타임에 맞는 PDF/Excel 라이브러리와 비동기 job이 필요하다.

기술적으로 가능하나 한글 폰트, 페이지 분할, 대량 증빙 ZIP, signed URL 만료를 반드시 테스트해야 한다.

## 9. 테스트 준비도

현재 root package에는 test script와 test framework가 없다. `npm run build`만으로는 금융 계산의 정확성을 증명할 수 없다.

도입 필요:

- Vitest: 산식, 정규화, 중복키, 매칭 점수
- React Testing Library: 상태·권한·오류 UX
- Playwright: 카드 연결→영수증→결산 E2E
- SQL/RLS test: 조직 격리와 unique constraint
- provider contract fixture: 카드사 응답 변경 감지

실제 카드·금액 데이터이므로 단위 테스트보다 API/CSV 병행 대조와 snapshot 회귀 테스트가 출시 판단에 더 중요하다.

## 10. 외부 차단 요소

### 하이픈

없으면 mock/CSV까지 구현 가능하지만 다음은 검증 불가능하다.

- 실제 사업자 인증
- 실제 보유카드 목록
- 실제 승인·취소·매입 데이터
- 원승인/부분취소 연결
- 카드사별 지연·점검·재인증

필요: 상품 신청, 테스트베드, User ID/HKey, API 명세, 카드사별 인증, 가격·약관.

### Google Vision

자격증명 없이 촬영·Storage·mock OCR까지 가능하다. 실제 OCR 정확도·비용·오류율 검증에는 GCP project와 Vision credential이 필요하다.

### LLM

API key와 모델 선택 없이는 JSON 구조화의 정확도·비용·지연시간을 검증할 수 없다. prompt version과 fixture 회귀 테스트가 필요하다.

### 법률·보안

- 카드 인증정보 보관 주체
- 금융 데이터 재제공 권리
- 개인정보 처리위탁/제3자 제공
- 영수증 원본·OCR 텍스트 보존기간
- 세무자료의 법적 보존 범위

기술 구현과 별도로 확정해야 한다.

## 11. 즉시 구현 가능한 범위

외부 키 없이 바로 시작 가능:

1. finance feature module 분리
2. 신규 card/expense/closeout migration
3. 카드 cascade 삭제 제거
4. mock provider와 fixture
5. CSV를 event/group 모델로 이전
6. 자동 연결 마법사 UI
7. 카드 상태·동기화 진행 UI
8. 촬영·갤러리·Storage 업로드
9. mock OCR 결과 검수 UI
10. 카드·영수증 매칭 엔진
11. 지출 원장
12. 결산 집계와 순익 차트 mock/실데이터 연결
13. PDF/Excel 보고서 골격
14. 테스트 기반

외부 권한 후 가능:

1. 하이픈 실제 인증·카드 조회
2. 승인·취소·매입 자동동기화
3. Vision 실제 OCR
4. LLM 실제 구조화
5. 운영 비용·지연·오류 측정
6. 실제 카드 2주 병행 Pilot

## 12. 권장 구현 순서

```text
0. 운영 DB 상태와 외부 권한 확인
1. 테스트 framework와 feature module 기반
2. backward-compatible DB migration
3. 카드 데이터 이관·cascade 위험 제거
4. mock/CSV provider와 중복·취소 테스트
5. 카드 연결 UI와 job worker
6. 하이픈 adapter
7. 영수증 촬영·Storage
8. Vision·LLM
9. 매칭·지출 확정·예외 업무함
10. 일·주·월·연 집계와 차트
11. PDF·Excel·ZIP
12. 실제 카드 2주 Pilot
```

## 13. 시작 전 필수 결정

| 결정 | 권장안 | 현재 |
|---|---|---|
| 하이픈 상품 | 법인카드 조회 단품부터 | 미확정 |
| 핵심 Pilot 카드사 | 실제 사용 카드 1개 | 미확정 |
| 차트 라이브러리 | React 호환 검증 library | 미설치 |
| PDF/Excel runtime | Vercel 호환 Node worker | 미선정 |
| 영수증 보존기간 | 법무·세무 검토 후 설정 | 미확정 |
| 운영순익 귀속 | 승인 잠정/매입 확정 | 기획 확정 |
| 주 시작·영업 cutoff | 조직 설정 | 구현 필요 |
| 자동 확정 | 초기 OFF | 기획 확정 |

## 14. 최종 Go/No-Go

### 개발 착수: Go

- 현재 앱 빌드 정상
- Supabase/Vercel 기반 재사용 가능
- 매출·급여 원천 존재
- 비공개 Storage와 서버 암호화 패턴 존재
- 외부 API를 adapter로 격리할 수 있음

### 실카드 연동 완료: Pending

- 하이픈 자격증명·명세 없음
- 실제 카드사 인증 방식 미확정
- provider 거래키·부분취소 필드 미확정

### 운영 출시: No-Go 현재

- 지출 원장·자동동기화·OCR·매칭·결산 snapshot 미구현
- 금융 계산 자동화 테스트 없음
- 2주 실제 카드 병행 대조 미실행
- 법률·보안·보존정책 미확정

## 15. 최종 결론

문서의 최종 기획은 현재 기술 환경에서 실제 구현 가능하다. 별도 플랫폼 전환이나 전면 재개발은 필요하지 않다. 다만 현재 카드 테이블에 기능을 바로 덧붙이는 방식은 데이터 삭제·중복·부분취소 문제를 만들 수 있으므로, 이벤트·거래 그룹·지출 원장을 먼저 구축해야 한다.

첫 개발 완료 판정은 다음과 같다.

> mock과 CSV로 승인·부분취소·매입을 중복 없이 한 지출로 계산하고, 그 결과가 일간 보고와 운영순익 차트에 동일하게 나타난다.

첫 외부 연동 완료 판정은 다음과 같다.

> 하이픈 테스트 카드가 자동 등록되고 실제 승인·취소·매입을 자동 수집하며, 카드사 CSV와 2주간 일별 순액이 일치한다.
