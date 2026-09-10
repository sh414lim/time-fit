# 하이픈 법인카드 Provider 어댑터

- 공식 OAuth `/oauth/token`을 서버에서 호출하고 만료 10분 전까지 토큰을 재사용한다.
- User ID, HKey, OAuth 토큰은 브라우저와 로그에 노출하지 않는다.
- 사업장별 카드사 인증 입력은 기존 AES-256-GCM 통합 암호화 모듈로 저장한다.
- 보유카드와 승인·취소·부분취소·매입·청구 응답을 TimeFit 공통 모델로 정규화한다.
- 카드 목록과 승인내역 TR 경로는 계약 개발가이드 수령 후 `HYPHEN_CARD_LIST_PATH`, `HYPHEN_CARD_EVENTS_PATH`로 주입한다.
- 계약 TR 경로가 없으면 운영 호출을 명확히 차단하며 Mock Provider는 계속 사용할 수 있다.
