# OCR → LLM → JSON 영수증 구조화 구현

Google Vision OCR 원문을 OpenAI Responses API에 전달하고 Structured Outputs의 JSON Schema로 결과 형식을 강제한다. 요청에는 `store: false`를 지정해 모델 응답 저장을 비활성화한다.

## 추출 필드

- 상호, 거래일, 거래시간
- 합계, 공급가액, 부가세
- 사업자등록번호, 승인번호, 카드 끝 4자리
- 지출 분류와 신뢰도

## 검증과 폴백

- 날짜·시간·금액·카드 끝 4자리 형식을 서버에서 다시 검증한다.
- 공급가액과 부가세 합이 총액과 다르면 세부 금액을 폐기하고 검토 대상으로 남긴다.
- OCR 원문 안의 지시문을 따르지 않도록 시스템 지침과 데이터 경계를 사용한다.
- LLM 키 미설정, 호출 실패, JSON 검증 실패 시 기존 규칙 기반 추출로 자동 대체한다.
- 사용 모델, 입력·출력 토큰, 폴백 여부와 오류 코드를 처리 이력에 저장한다.

## 환경변수

- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_API_URL=https://api.openai.com/v1/responses`

API 키와 모델은 서버에만 설정하고 `VITE_` 접두사를 사용하지 않는다.
