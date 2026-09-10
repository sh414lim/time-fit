# TimeFit 지출·증빙 1차 개발 결과

작성일: 2026-09-10  
범위: 최종 로드맵 Sprint 1 기반 개발

## 구현 완료

- 카드 연결 상태·동의·오류·최근/다음 동기화 DB
- 연결에서 발견된 provider 카드와 TimeFit 카드 매핑
- 카드 동기화 run/cursor와 작업 멱등 키
- 승인·취소·부분취소·매입·청구·결제 불변 이벤트
- 카드 거래 그룹과 승인/매입/취소/순액
- 단일 지출 원장, 복수 원천, 매칭 후보
- 일·주·월·연 결산 snapshot과 line
- 금융 감사 로그
- 기존 카드·CSV 거래의 event/group 호환 이관 SQL
- 카드 거래 cascade 삭제 차단
- 물리 삭제 대신 연결 해제 RPC와 과거 원장 보존
- provider 카드 ID 기반 고유 식별
- Mock Card Provider
- 카드 이벤트 중복 제거·상태/순액 계산 도메인 모듈
- 운영순익 계산 모듈
- Node 내장 test runner
- 카드 화면의 `카드사 자동 연결`과 `카드 수동 등록` 분리
- 자동 연결 4단계 안내
- `삭제`를 `연결 해제`로 변경하고 보존 안내
- 하이픈·Vision·LLM 환경변수 템플릿

## 검증 결과

- `npm test`: 3/3 통과
  - 동일 이벤트 재수집 중복 방지
  - 전체·부분취소 순액과 상태
  - 운영순익 산식
- `npm run build`: 성공
- Vite 모듈 118개 변환
- git diff whitespace 검사: 통과
- 로컬 앱 로그인 화면 로드 확인

## 생성·수정 파일

- `supabase/migrations/20260910000200_expense_ledger_foundation.sql`
- `src/features/finance/cardDomain.js`
- `src/features/finance/mockCardProvider.js`
- `test/card-domain.test.js`
- `src/lib/supabase.js`
- `src/main.jsx`
- `src/finance.css`
- `package.json`
- `.env.example`

## 아직 적용하지 않은 항목

- 원격 Supabase migration 적용
- Vercel Production 배포
- 하이픈 실제 인증/API 호출
- Google Vision/LLM 호출

원격 migration 상태 확인은 현재 실행 환경에서 Supabase DB DNS 연결과 비밀번호 입력 단계로 인해 완료하지 못했다. 운영 DB 적용 전에 dry-run, 실제 migration 목록, 백업·rollback 확인이 필요하다.

## 다음 단계

1. 운영/QA DB migration dry-run
2. QA DB에 신규 migration 적용
3. 기존 카드·CSV 이관 건수와 합계 검증
4. 관리자 로그인 상태에서 자동 연결/수동 등록/연결 해제 UI E2E
5. Mock Provider를 job worker에 연결
6. CSV importer를 새 event/group 모델로 이전
7. 하이픈 테스트베드 자격증명 확보 후 실제 adapter 구현

## 주의사항

이번 단계는 기반 개발이다. 화면의 자동 연결 버튼은 연결 절차를 안내하지만 하이픈 키가 없으므로 아직 실제 카드사 인증을 시작하지 않는다. 기존 CSV 저장 경로도 호환성 때문에 유지하며 다음 단계에서 새 이벤트 원장으로 전환한다.
