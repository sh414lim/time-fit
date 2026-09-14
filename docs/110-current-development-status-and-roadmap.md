# TimeFit 현재 개발 현황 및 통합 기획 정리

## 1. 문서 목적

현재 TimeFit 작업공간에 존재하는 구현 변경과 기획 문서를 기능별로 분리하고, 완료 상태·검증 상태·남은 작업·Git 반영 순서를 정리한다. 기준 범위는 `지출 증빙 작업` 이후 진행된 금융 기능과 현재 진행 중인 스케줄·직원 정렬 개선이다.

## 2. 현재 기준점

- 현재 HEAD: `82f58f4 feat: add card connection reauthentication`
- `origin/main`: `82f58f4`
- 현재 브랜치: `codex/expense-evidence-card-sprint1`
- 카드 재인증까지 Git main에 반영됨
- 그 이후 스케줄·직원 정렬 변경과 카드 Provider 기획 문서는 아직 커밋되지 않음
- 운영 배포는 인증 문제로 최신 main 반영 여부를 별도 확인해야 함

배포 원칙:

```text
코드 변경
→ 테스트·프로덕션 빌드
→ 기능별 Git commit
→ GitHub main push
→ Git 기반 production 배포
→ production commit·smoke test 확인
```

## 3. 현재 변경사항 분류

### 3.1 스케줄 수정·취소 및 근무자 표시

상태: 구현 완료, 로컬 검증 완료, 미커밋

구현 내용:

- 주간 스케줄의 팀별 인원 집계를 실제 근무자 이름 목록으로 변경
- 월간 스케줄에 실제 근무자 이름과 초과 인원 표시
- 근무자의 소속 배지와 이름 표시
- 휴무·연차 직원을 근무자 목록에서 제외
- 월간 상세에서 `수정·취소`를 실제 schedule edit modal에 연결
- `schedule.manage` 권한이 없는 사용자에게 수정·취소 버튼 숨김
- 삭제 결과 0건을 성공으로 오인하지 않고 권한/대상 오류 표시
- 위임 관리자의 담당 범위 내 스케줄 삭제 RLS 정책

관련 파일:

- `src/main.jsx`
- `src/navigation.css`
- `src/sheet.css`
- `src/lib/supabase.js`
- `src/scheduleDomain.js`
- `test/schedule-domain.test.js`
- `supabase/migrations/20260911000100_delegated_schedule_delete.sql`

검증:

- 전체 테스트 43개 통과
- 프로덕션 빌드 성공
- `git diff --check` 성공

남은 작업:

- 공통 파일에 섞인 직원 정렬 변경과 분리해 부분 staging
- migration 적용 순서 확인
- 기능별 commit/push
- Git 기반 배포와 운영 권한별 smoke test

### 3.2 직원 순서·PDF 표시

상태: 구현 변경 존재, 미커밋

구현 내용:

- 직원관리에서 드래그 순서 저장
- 사용자별 직원 표시 순서 preference
- 직원 목록에 순번 표시
- 스케줄 PDF에 직원별 색상 적용

관련 파일:

- `src/main.jsx`
- `src/lib/supabase.js`
- `src/schedulePdf.js`
- `src/styles.css`
- `supabase/migrations/20260911000200_staff_order_rpc.sql`
- `supabase/migrations/20260911000300_account_staff_order.sql`

주의사항:

- `20260911000200_staff_order_rpc.sql`은 조직 공통 순서 방식이다.
- `20260911000300_account_staff_order.sql`은 동일 RPC를 사용자별 preference 방식으로 다시 정의한다.
- 최종 요구가 사용자 개인별 순서라면 두 migration을 순서대로 적용할 수 있으나, 신규 환경 기준으로 최종 schema가 명확하도록 통합 또는 설명 보완이 필요하다.
- `src/main.jsx`와 `src/lib/supabase.js`는 스케줄 취소 변경과 동일 파일을 사용하므로 commit 분리 시 hunk 단위 staging이 필요하다.

남은 작업:

- 사용자별 순서가 최종 정책인지 확인
- migration 명칭·의도 정리
- 권한별 RPC 테스트 추가
- 새 계정·기존 계정·일부 직원만 보이는 위임 관리자 테스트
- PDF 시각 확인

### 3.3 지출 증빙·결산

상태: 주요 기능은 main 기준 구현됨

기준 문서:

- `docs/64-expense-evidence-planning-and-design.md`

현재 구현된 범위:

- 영수증 사진/PDF 업로드
- OCR/구조화와 검토 상태
- 지출 원장과 카드 거래 source
- 중복 증빙·매칭 후보
- 직원 증빙 제출과 관리자 검토
- 예외함과 리마인드
- 결산·재오픈·감사 정보
- 일·주·월·연 단위 재무 보고서
- 카드수수료·매출연동 임대료·구매비 분류

운영 확인이 필요한 범위:

- 실제 Vision/LLM 운영 키와 처리 성공률
- 실제 Toss 매출 최신 동기화
- 영수증 Storage 보존·파기
- 확정 결산 snapshot 불변성
- 운영 배포가 main commit과 일치하는지

### 3.4 기존 법인카드 연결 기능

상태: 골격 구현, 실제 Provider 완성 전

현재 구현:

- 카드 연결 동의
- connection/asset/card/sync run/cursor DB
- Mock Provider
- Hyphen OAuth·인증정보 암호화·normalizer 골격
- 보유카드 discovery와 선택
- 최초 90일·7일 overlap 증분 수집
- 승인·취소·부분취소·매입 이벤트
- 장애 분류와 재인증
- 연결 변경 이력

미완료:

- Hyphen 계약 endpoint와 카드사별 실제 인증 field
- 실제 카드사 데이터 대사
- 전체 카드번호가 provider ID fallback으로 저장될 가능성 제거
- 금융 세부 권한과 교차 조직 자동 테스트
- 일반 DB 암호문을 Vault reference로 이전
- 장기 작업을 Queue Worker로 분리

### 3.5 외부 카드 Provider 기반 기획

상태: 외부 Provider 사용으로 방향 확정, 계약·실명세 대기

핵심 정의:

```text
TimeFit 내부 동의·Provider 인증
→ 계약 Provider Adapter
→ 보유카드 발견
→ 카드 선택·담당자 지정
→ 승인·취소·매입 수집
→ 중복 제거·거래 그룹
→ 직원 증빙·지출 원장·결산
```

주요 기획 문서:

- `101-financial-data-connector-platform-research-plan.md`
- `102-multitenant-card-expense-plan-review-and-development-scenarios.md`
- `103-card-expense-feasibility-and-detailed-execution-plan.md`
- `104-corporate-card-data-acquisition-deep-research.md`
- `105-timefit-owned-card-provider-architecture-plan.md`
- `106-card-connector-and-collection-engine-spec.md`
- `107-owned-card-provider-final-review-and-user-scenarios.md`
- `108-timefit-owned-corporate-card-provider-master-prd.md`
- `109-owned-card-provider-user-scenario-catalog.md`

최상위 기준은 `111`로 한다. `102`는 멀티테넌트 사용자 시나리오, `106`은 기존 Connector 조사 자료로 활용하고 `105`~`109`의 자체 수집 방향은 조사 이력으로만 유지한다.

## 4. 제품 구조 정리

### 4.1 근태·스케줄 영역

```text
직원 순서
→ 스케줄 등록·일괄등록
→ 수정·취소
→ 주간·월간 이름 표시
→ 직원별 색상 PDF
→ 승인·배포
```

### 4.2 지출 증빙 영역

```text
영수증 업로드
→ OCR/AI 구조화
→ 카드 거래 후보 매칭
→ 직원 사유·프로젝트·태그
→ 관리자 예외 검토
→ 확정 지출 원장
→ 월 결산·보고서
```

### 4.3 외부 카드 Provider 연동 영역

```text
금융정보 수집 동의
→ 계약 Provider 인증 세션
→ Provider token/Vault reference
→ Provider Adapter
→ 보유카드 discovery
→ Queue 기반 거래 수집
→ 표준 이벤트·거래 그룹
→ 지출 증빙 영역 연결
```

세 영역은 독립 배포가 가능해야 한다. 카드 Provider 장애가 스케줄·근태 또는 수기 지출 입력을 막아서는 안 된다.

## 5. 다음 개발 순서

### 단계 1 — 현재 로컬 변경 정리

목표: 동시에 진행된 변경을 안전하게 Git에 반영한다.

1. 스케줄 수정·취소 변경과 직원 정렬 변경의 diff를 hunk 단위로 분류
2. 직원 순서 migration 두 개의 최종 의도 정리
3. 권한·기존 데이터 migration 테스트
4. 전체 테스트·빌드 재실행
5. 기능별 commit 생성
6. main push
7. Git 기반 production 배포
8. 운영 화면 smoke test

권장 commit 경계:

```text
fix: complete schedule editing and cancellation
feat: persist personal staff ordering and pdf colors
docs: add owned corporate card provider planning
```

### 단계 2 — 지출 증빙 운영 검증

목표: 이미 구현된 지출 증빙이 운영에서 실제로 닫힌 흐름인지 확인한다.

- 영수증 업로드→OCR→검토→지출 확정 E2E
- 직원 제출→관리자 반려→재제출
- 중복 파일·금액 불일치
- 카드 거래 없는 영수증과 영수증 없는 카드 거래
- 결산 확정·재오픈·보고서
- 조직 간 영수증 Storage 접근

완료 기준:

- 실제 모바일 사진 10건 처리
- 중복·오매칭 0건
- 권한별 접근 테스트 통과
- 확정 보고서와 원장 합계 일치

### 단계 3 — 외부 카드 Provider P0

목표: 운영 Provider 연동 전 보안·교체 가능 기반을 만든다.

- Hyphen normalizer의 `cardNo` ID fallback 제거
- finance permission
- 조직 A/B RLS/API/Storage/Queue 테스트
- Provider Adapter contract와 capability
- Vault/Credential Broker 경계
- Queue/Worker/lease 설계와 Mock 전환

완료 기준:

- Mock 인증→카드 발견→90일 job→event→expense E2E
- PAN·secret DB/로그 0건
- 교차 조직 접근 0건

### 단계 4 — 계약 Provider Sandbox POC

목표: 계약 Provider의 테스트베드에서 실제 인증과 카드 discovery를 검증한다.

- Pilot 법인과 카드사 선정
- 법인 관리자 테스트 계정·카드 확보
- Provider 제공 인증 방식·추가 인증 조사
- Provider 계약·데이터 이용범위·카드사 지원범위 검토
- 보유카드 조회
- 승인 샘플 조회
- 실제 CSV 90일 확보

완료 기준:

- Provider 인증 세션 성공
- 카드 1장 이상 token+last4 discovery
- 인증정보·PAN 비저장
- 반복 가능한 POC 기록

### 단계 5 — 첫 운영 Provider Adapter

- 승인·전체취소·부분취소·매입 parser
- 페이지·기간·cursor
- 90일 백필
- 계약 단가와 rate limit에 따른 1~6시간 증분 동기화
- 재인증·점검·429·schema 변경
- CSV 일별 대사

완료 기준:

- 30일 일별 순액 100% 일치
- 동일 범위 3회 수집 후 합계 불변
- 2주 Pilot P0/P1 장애 0건

## 6. 사용자 시나리오 요약

### 스케줄 관리자

1. 직원 표시 순서를 드래그해 개인별로 저장한다.
2. 스케줄을 등록·일괄등록한다.
3. 주간·월간 화면에서 실제 근무자 이름을 확인한다.
4. 등록된 일정을 열어 시간·휴게·근무유형을 수정한다.
5. 취소 권한이 있으면 일정을 취소한다.
6. 직원별 색상이 반영된 PDF를 출력한다.

### 비용관리자

1. 카드사를 연결하고 보유카드를 선택한다.
2. 카드별 직원·부서·매장을 지정한다.
3. 최근 90일 내역을 수집한다.
4. 카드사 CSV로 금액을 대사한다.
5. 미증빙·부분취소·금액차이를 예외함에서 처리한다.
6. 결산 보고서를 확정한다.

### 카드 담당 직원

1. 신규 카드 거래 알림을 확인한다.
2. 지출 사유·프로젝트·태그를 입력한다.
3. 영수증을 촬영·업로드한다.
4. 관리자 보완 요청이 오면 수정 후 재제출한다.

### 회사 소유자

1. 금융정보 처리에 동의한다.
2. 공동인증서 또는 기업 계정으로 카드사를 인증한다.
3. 인증 만료 시 재인증한다.
4. 월 결산과 손익 보고서를 확인한다.
5. 필요하면 카드 연결을 일시정지·해제한다.

## 7. 위험과 대응

| 위험 | 현재 상태 | 대응 |
| --- | --- | --- |
| 공통 파일 변경 충돌 | 발생 | hunk staging과 기능별 commit |
| migration RPC 재정의 | 확인 필요 | 최종 개인별 정책 기준 통합 검토 |
| 최신 코드 미배포 | 가능 | main commit과 production asset 확인 |
| 카드 PAN 저장 가능성 | P0 | fallback 즉시 제거 |
| Provider 계약 없이 실제 조회 불가 | 지속 | Mock·CSV 기반 개발 후 계약 Sandbox 연결 |
| 공동인증서 브라우저 접근 | 미확정 | Provider가 제공하는 인증 방식만 지원 |
| 장기 sync timeout | 구조적 | Queue Worker 분리 |
| 카드사 화면 변경 | 상용 위험 | fingerprint·fixture·kill switch |
| 교차 회사 금융정보 노출 | 최고 위험 | 다층 조직 검증·자동 공격 테스트 |

## 8. 현재 승인·보류 판정

승인:

- 스케줄 수정·취소 기능 방향
- 근무자 이름과 직원별 PDF 색상
- 사용자별 직원 순서 저장
- 지출 증빙→지출 원장→결산 구조
- 외부 카드 Provider 기반, 교체 가능한 Adapter 방향
- Provider 1곳·고객사 1곳부터 시작하는 Pilot

보완 후 승인:

- 직원 순서 migration 구조
- 스케줄 변경의 기능별 Git 분리
- Vault 제품과 Queue 인프라
- Provider별 인증 방식과 credential 책임 경계

보류:

- 모든 카드사 동시 개발
- 자체 카드사 스크래핑 개발·상용화
- 개인카드·개인사업자 동시 출시
- 전체 PAN·CVC 보관

## 9. 즉시 실행 체크리스트

- [ ] 스케줄/직원 정렬 diff 분리
- [ ] migration 001/002/003 적용 순서와 최종 schema 검토
- [ ] 권한별 스케줄 수정·취소 테스트
- [ ] 직원 개인별 순서 저장 테스트
- [ ] PDF 시각 확인
- [ ] 전체 테스트·빌드
- [ ] 기능별 commit/main push
- [ ] Git 기반 production 배포
- [ ] 운영 smoke test
- [ ] 지출 증빙 운영 E2E
- [ ] 카드 PAN fallback 제거
- [ ] 운영 Provider·Pilot 고객사 선정

## 10. 기준 문서

- 지출 증빙 시작 기준: `64-expense-evidence-planning-and-design.md`
- 카드 수집 심층 조사: `104-corporate-card-data-acquisition-deep-research.md`
- Connector 기술 명세: `106-card-connector-and-collection-engine-spec.md`
- 외부 Provider 최종 기준: `111-external-card-provider-final-plan-and-architecture.md`
- 사용자 시나리오: `109-owned-card-provider-user-scenario-catalog.md`

이 문서를 현재 개발 현황과 다음 실행 순서의 기준으로 사용한다.
