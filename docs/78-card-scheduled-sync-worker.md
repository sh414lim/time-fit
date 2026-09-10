# 카드 예약 동기화 워커 구현 결과

## 구현 내용

- 수동 최초 수집과 예약 수집이 동일한 `runCardSync` 처리기를 사용한다.
- 카드 연결별 다음 실행 시각(`next_sync_at`)을 기준으로 최대 10개 연결을 처리한다.
- 6시간 단위 멱등성 키로 동일 시간대 중복 실행을 차단한다.
- 성공 시 다음 수집 시각을 6시간 뒤로 갱신한다.
- 네트워크·인증·호출 제한·잘못된 요청 오류를 구분해 연결 상태에 기록한다.
- 일반 오류는 1시간 뒤 재시도하며 인증 오류는 `reauth_required`로 전환한다.
- 워커는 `CARD_SYNC_CRON_SECRET` 또는 Vercel의 `CRON_SECRET`으로만 호출할 수 있다.
- 예약 워커는 브라우저 사용자 토큰 대신 Supabase Service Role로 검증된 원장 RPC를 호출한다.

## 예약 주기

Vercel Cron에서 매 6시간 15분에 `/api/card-sync-worker`를 호출한다. 실제 카드사 호출 제한과 요금제가 확정되면 카드사별 주기를 조정한다.

## 배포 전 필수 순서

1. `20260910000400_card_sync_service_role.sql` 적용
2. `CARD_SYNC_CRON_SECRET` 또는 `CRON_SECRET` 등록
3. Preview 환경에서 Mock 연결의 최초 수집 확인
4. 워커 수동 호출로 중복 제외 및 다음 실행 시각 확인
5. Cron 실행 로그와 실패 상태 확인

마이그레이션을 적용하지 않고 워커를 먼저 배포하면 Service Role의 원장 RPC 실행이 거부될 수 있다.
