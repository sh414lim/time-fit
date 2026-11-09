# TimeFit AX 운영 복구

웹/API는 Vercel, 업무 DB와 분석용 원본은 Supabase, 원본 백업은 Google Drive에 있다.
현재 AX는 Mac의 Java 서버(8351)이며 Codex CLI를 실행한다. AX 분석 기록은 로컬 H2 DB에 저장된다.
Docker의 `timefit-ax-cloudflared`는 AX로 연결하는 독립 Quick Tunnel이다. 이 구성은 Caddy를 거치지 않으므로 URL에 `/timefit-ax`를 붙이지 않는다.
공용 Caddy 터널을 사용하는 다른 배포에서만 `/timefit-ax` 접두사를 사용한다.

## 점검

운영 환경의 아래 세 변수를 안전하게 주입한 셸에서 `npm run check:ax`를 실행한다.
키를 커밋하거나 채팅·로그에 출력하지 않는다.

- `TIMEFIT_AX_URL`: 현재 터널 HTTPS 주소. 독립 터널은 루트 주소.
- `TIMEFIT_AX_ALLOWED_HOSTS`: 위 주소의 호스트만 입력. 프로토콜·경로 제외.
- `TIMEFIT_AX_TRANSPORT_KEY`: AX와 웹에 동일한 32자 이상 공유키.

점검은 새 무작위 ID에 GET만 전송한다. 무인증 401, 인증 후 존재하지 않는 ID의 404를 확인하며 영수증·지출을 생성하지 않는다. 실패하면 종료 코드 1이다.
성공은 연결과 인증 확인만 의미한다. Codex 인증, 새 이미지 분석, Vercel 배포 설정 또는 지출 저장 성공을 보장하지 않는다.

## 복구 순서

1. Docker를 실행하고 `docker start timefit-ax-cloudflared`로 해당 터널만 시작한다.
2. Mac의 `com.timefit.ax` 자동 실행 서비스와 8351 포트 응답을 확인한다. launchctl에 PID가 있다고 준비 완료로 판단하지 않는다. `~/Library/Logs/TimefitAX/`의 시작 로그와 HTTP 응답을 확인한다.
3. 터널 재시작 후 최신 로그에서 HTTPS 주소를 확인한다. Quick Tunnel은 주소가 바뀔 수 있다.
4. TimeFit Vercel 프로젝트의 Production URL과 허용 호스트를 함께 갱신하고, 공유키 일치를 확인한다. 새 설정으로 재배포한다. 다른 계정의 프로젝트에 배포하지 않는다.
5. `npm run check:ax`로 연결·인증을 확인한다.
6. 운영 화면에서 승인된 테스트 영수증을 제출한다. 분석 결과와 지출 저장을 확인하고 처리 이력의 분석 제공자가 AX인지 확인한다. Google Vision 폴백 성공을 AX 성공으로 보고하지 않는다.

완료 보고에는 배포 버전, 연결 점검 결과, 실제 업로드 분석 결과를 구분한다. 운영 권한이 없거나 실제 업로드를 검증하지 못했다면 미완료로 기록한다.
이 Mac의 절전·종료, Docker 중지, Codex 로그인 만료는 분석 중단 원인이 될 수 있다. Quick Tunnel 자동 재시작만으로 Vercel 주소가 자동 갱신되지는 않는다.
