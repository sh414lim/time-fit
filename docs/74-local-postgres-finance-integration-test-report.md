# TimeFit 금융 원장 로컬 PostgreSQL 통합 테스트

작성일: 2026-09-10  
브랜치: `codex/expense-evidence-card-sprint1`

## 실행 환경

- Docker PostgreSQL: Supabase local container의 격리 테스트 DB
- 운영/기존 프로젝트 테이블: 미사용
- 적용 순서: 최소 prerequisite → 001 카드 → 002 원장 기반 → 003 이벤트 import RPC
- 테스트 종료 후 격리 DB 2개 삭제 완료

## 결과

| 항목 | 기대 | 결과 |
|---|---|---|
| 001→002→003 migration | SQL 오류 없이 적용 | 통과 |
| 최초 이벤트 import | 3건 수집 | 통과 |
| 동일 배치 재실행 | 신규 0, 중복 3 | 통과 |
| 거래 그룹 | 1개 | 통과 |
| 승인액 | 120,000원 | 통과 |
| 매입액 | 120,000원 | 통과 |
| 부분취소 | 20,000원 | 통과 |
| 순액 | 100,000원 | 통과 |
| 상태 | partially_cancelled | 통과 |
| 연결 해제 | disconnected+archived | 통과 |
| 연결 해제 후 이벤트 | 3건 유지 | 통과 |
| 카드 물리 삭제 | FK로 차단 | 통과 |

## 재현 파일

- `test/sql/finance-prerequisites.sql`
- `test/sql/card-event-integration.sql`
- `supabase/migrations/20260910000100_corporate_cards.sql`
- `supabase/migrations/20260910000200_expense_ledger_foundation.sql`
- `supabase/migrations/20260910000300_card_event_import_rpc.sql`

## 판정

새 금융 migration과 카드 이벤트 import RPC는 격리된 실제 PostgreSQL에서 동작했다. 원격 QA 적용 전 남은 위험은 운영 DB의 실제 migration 이력, 기존 데이터 규모, 실제 RLS membership 함수와 하이픈 응답 필드다.

다음 단계는 QA/운영 DB migration dry-run과 백업 확인 후 적용하는 것이다. 운영 DB 자격증명이 없으면 Mock Provider 작업 큐와 카드 연결 서버 API 개발을 먼저 진행할 수 있다.
