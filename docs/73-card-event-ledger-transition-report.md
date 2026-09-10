# TimeFit 카드 이벤트 원장 전환 결과

작성일: 2026-09-10  
브랜치: `codex/expense-evidence-card-sprint1`

## 완료 작업

- CSV/API/이메일/Mock이 공통으로 사용할 서버 이벤트 import RPC 추가
- 조직·카드 권한 검증
- 요청당 최대 1,000개 이벤트 제한
- provider event ID 기반 멱등 저장
- provider group key 기반 승인·취소·매입 그룹화
- 승인액·매입액·취소액·순액 자동 재계산
- pending/acquired/cancelled/partially_cancelled/billed 상태 계산
- 카드 최근 동기화 시각 갱신
- imported/duplicates/groups 결과 반환
- import 감사 로그 기록
- 카드 거래 화면 조회를 legacy transaction에서 transaction group으로 전환
- CSV import를 새 RPC로 전환
- 순 이용금액을 거래 그룹의 net amount 합계로 전환

## 검증

- `npm test`: 3/3 통과
- `npm run build`: 성공
- `git diff --check`: 통과

## 파일

- `supabase/migrations/20260910000300_card_event_import_rpc.sql`
- `src/lib/supabase.js`
- `src/main.jsx`

## 남은 검증

- QA Supabase에 002/003 migration 순서 적용
- 기존 CSV 거래의 group/event 이관 건수 비교
- 동일 CSV 3회 업로드 DB 통합 테스트
- 승인+부분취소+매입 fixture RPC 테스트
- 관리자 브라우저에서 월 거래 목록과 순 이용금액 확인

운영 DB와 Production 배포는 아직 수행하지 않았다.
