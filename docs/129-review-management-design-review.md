# 네이버·캐치테이블 리뷰 관리 구현 설계 검토

> 상태: 수동 가져오기를 가정했던 이전 검토. `사용자의 반복 작업 0` 요구사항 반영 후에는 `130-zero-touch-review-collection-architecture.md`가 우선한다.

검토 대상: `128-naver-catchtable-review-implementation-design.md`

## 1. 종합 판정

**조건부 개발 진행 가능(Conditional GO)**

제품 방향과 사용자 흐름은 적절하다. 특히 서버 크롤링을 기본 범위에서 제외하고, 기존 `timefit_user_feedback_items` 및 단일 Next.js API 진입점을 재사용하는 판단은 현재 TimeFit 구조에 맞다.

다만 미리보기 상태 저장, 중복 식별자, 권한/RLS, 비동기 분석 구조는 구현 전 보완이 필요하다. 아래 P0 항목을 먼저 설계에 반영하지 않으면 중복 리뷰, 권한 누수, 요청 크기 초과, 분석 작업 타임아웃 가능성이 있다.

### 항목별 평가

| 영역 | 평가 | 의견 |
|---|---:|---|
| 제품 목표 | 9/10 | 개인 매장 운영 목적과 명확하게 연결됨 |
| 정책·준수 | 9/10 | 차단 우회 제외 및 공식 경로 우선 원칙 적절 |
| 사용자 흐름 | 8/10 | 미리보기 후 확정 구조가 안전함 |
| 기존 코드 적합성 | 7/10 | 기존 피드백 테이블과 UI를 활용할 수 있음 |
| 데이터 설계 | 6/10 | 중복 식별자가 이중화되어 보완 필요 |
| API·비동기 처리 | 6/10 | 동적 라우트와 대량 분석 구조 수정 필요 |
| 보안·개인정보 | 7/10 | 방향은 적절하나 AI 입력 방어와 해시 방식 보완 필요 |
| 테스트 가능성 | 8/10 | 테스트 시나리오가 구체적임 |

## 2. 현재 코드와의 적합성

### 재사용 가능한 부분

현재 프로젝트에는 이미 다음 기능이 존재한다.

- `timefit_user_feedback_items`
- `source`: `naver`, `catchtable` 지원
- `(organization_id, source, external_id)` 고유 제약
- 작성자, 평점, 내용, 작성일, 처리 상태 저장
- 브라우저 CSV 파싱
- 헤더 자동 매핑
- CSV 내용 기반 ID 생성
- `리뷰 · 컴플레인` 목록과 처리 완료 기능
- `pages/api/[...route].js` 단일 서버리스 함수 라우팅
- 관리 계정별 permission 코드 검사 함수

따라서 새 제품을 별도로 만들 필요는 없다. 기존 `FeedbackHub`의 CSV 파서와 UI를 모듈로 분리하고 서버 검증·분석을 추가하는 방식이 적합하다.

### 그대로 사용할 수 없는 부분

- 현재 CSV fingerprint는 DJB2 형태의 짧은 해시이므로 충돌 방지용 영구 ID로 부족하다.
- 외부 리뷰 가져오기가 브라우저에서 Supabase로 직접 upsert되므로 서버 권한·감사 이력·미리보기 무결성을 보장하기 어렵다.
- 현재 목록은 전체 항목을 한 번에 읽으므로 리뷰 수가 증가하면 페이지 진입 때마다 로딩이 길어진다.
- 기존 처리 상태는 단순 open/resolved 중심이라 긴급 검토와 분석 대기를 구분하지 못한다.

## 3. P0 — 구현 전 반드시 수정할 항목

### P0-1. `external_id`와 `source_review_id`를 이중 기준으로 사용하지 않는다

기존 테이블에는 이미 다음 고유 제약이 있다.

```sql
unique (organization_id, source, external_id)
```

설계안처럼 `source_review_id`를 추가하고 별도 고유 인덱스를 만들면 두 식별자가 서로 달라질 수 있다. 어떤 키가 진짜 중복 기준인지 불명확해진다.

#### 수정 권고

`external_id`를 유일한 저장 식별자로 유지한다.

- 채널 원본 ID가 있으면: `native:<원본ID>`
- 원본 ID가 없으면: `hash:<SHA-256>`
- 원본 ID 자체가 필요한 경우 `metadata.sourceNativeId`에 보관
- `content_hash`는 내용 변경 비교용으로만 사용

이 구조는 기존 데이터 및 upsert 로직과 호환된다.

### P0-2. 대량 미리보기를 서명 토큰 본문에 넣지 않는다

리뷰 최대 1,000건을 JSON으로 서명 토큰에 담으면 브라우저 요청 헤더·본문 크기가 커지고 Vercel 요청 한도와 브라우저 저장 한도에 걸릴 수 있다. 사용자 수정값을 토큰과 병합하는 과정도 복잡하다.

#### 수정 권고

다음 임시 테이블을 사용한다.

- `timefit_user_review_import_previews`
- `timefit_user_review_import_preview_rows`
- 유효기간 30분
- raw 파일은 저장하지 않고 정규화된 행만 저장
- 브라우저에는 `previewId`만 반환
- commit 시 조직·사용자·만료 여부를 다시 확인
- 완료 또는 만료된 preview는 정리 작업으로 삭제

preview row에는 `action`, `warnings`, `normalized_data`, `existing_feedback_id`를 저장한다.

### P0-3. 신규 권한 코드를 DB 제약과 설정 UI에 함께 반영한다

현재 `timefit_user_management_permissions.permission_code`는 마이그레이션의 check constraint로 허용 코드가 제한된다. API에서 `reviews.view`를 검사하는 것만으로는 저장할 수 없다.

#### 수정 권고

한 마이그레이션에서 다음 작업을 수행한다.

1. 기존 permission check constraint 검색 및 삭제
2. `reviews.view`, `reviews.import`, `reviews.manage`를 포함해 재생성
3. 관리 계정 설정 화면에 권한 토글 추가
4. RLS 정책에 소유자와 해당 permission 반영
5. 기존 소유자는 별도 데이터 없이 항상 허용

가져오기와 수정은 브라우저에서 Supabase에 직접 쓰지 않고 서버 API가 서비스 역할로 수행하되, 매 요청마다 `authorizeFinance`와 동일한 관리 계정 검사를 거친다.

### P0-4. 현재 라우터에 맞게 API 주소를 수정한다

현재 `pages/api/[...route].js`는 문자열로 등록된 handler를 찾는다. `/api/reviews/:id` 같은 동적 패턴 매칭은 구현되어 있지 않다.

#### 수정 권고

`server/routes/reviews.js`에 정확한 경로를 등록한다.

```js
export const reviewRoutes = {
  'reviews': reviews,
  'reviews/import-preview': reviewImportPreview,
  'reviews/import-commit': reviewImportCommit,
  'reviews/dashboard': reviewDashboard,
  'reviews/analyze': reviewAnalyze,
  'reviews/import-runs': reviewImportRuns,
};
```

상세 항목은 `/api/reviews?reviewId=<uuid>`로 읽고 PATCH한다. 또는 `reviews/detail`이라는 정확 경로를 사용한다.

### P0-5. 분석을 import 요청 안에서 모두 실행하지 않는다

리뷰 1,000건을 가져온 뒤 같은 HTTP 요청에서 AI 분석까지 실행하면 함수 제한 시간과 모델 rate limit을 초과할 수 있다.

#### 수정 권고

commit은 DB 저장까지만 완료하고 즉시 결과를 반환한다.

```text
commit 성공
  → analysis_jobs 생성
  → background worker가 10~20건씩 처리
  → 실패 건 지수 백오프, 최대 3회
  → UI는 pending/processing/completed/failed 표시
```

현재 receipt processing run 패턴을 재사용할 수 있다. 최초 구현은 한 번에 100건 이하로 제한하고 Next.js `after()`로 작업하되, 운영량이 늘면 Supabase Cron/Queue 기반 worker로 이전한다.

### P0-6. 리뷰 본문을 신뢰할 수 없는 AI 입력으로 처리한다

리뷰 본문에는 모델에 대한 명령문, 개인정보, 외부 URL 등이 포함될 수 있다. 본문을 그대로 시스템 지시와 이어 붙이면 prompt injection 위험이 있다.

#### 수정 권고

- 본문을 구조화된 `reviewText` 데이터 필드로 전달
- 시스템 프롬프트에 리뷰 속 명령을 따르지 않도록 명시
- 분석 모델에 도구 호출 권한을 주지 않음
- Structured Outputs JSON Schema 적용
- 닉네임·원문 URL·관리자 메모는 모델에 전달하지 않음
- 출력 길이와 키워드 개수 제한
- 저장 전 enum과 숫자 범위를 서버에서 재검증

### P0-7. OCR 이미지의 저장·삭제 주기를 명시한다

화면 캡처에는 닉네임·프로필 사진·예약 정보가 포함될 수 있다. 단순히 “분석 후 삭제”라고만 하면 실패 작업에서 파일이 남을 수 있다.

#### 수정 권고

- private storage 버킷 사용
- 업로드 경로: `{organizationId}/{previewId}/{page}`
- signed URL만 사용
- 정상/실패와 무관하게 24시간 후 삭제
- OCR 이후 프로필 이미지는 저장하지 않음
- import run에는 storage path 대신 삭제 여부만 기록

## 4. P1 — 1차 출시 전에 보완할 항목

### P1-1. 평점 없는 네이버 리뷰의 지표를 분리한다

평점 없는 리뷰가 많으면 `평균 평점` 카드가 채널 전체 품질을 대표하지 못한다.

#### 수정 권고

- 평균 평점 옆에 `평점 포함 n건` 표시
- 네이버는 긍정·부정 언급률을 기본 지표로 사용
- 채널 통합 평균은 평점이 있는 리뷰만 계산
- 이전 기간 비교도 동일 모집단 기준으로 계산

### P1-2. 캐치테이블 세부 평점을 metadata에 보존한다

캐치테이블 입력 형식에 음식·서비스·분위기 등의 세부 평점이 있을 수 있다. 전체 평점만 저장하면 나중에 다시 가져올 수 없다.

#### 수정 권고

`metadata.ratings`에 원본 세부 평점을 보존하고 `rating`에는 대표 평점만 저장한다. 실제 샘플 파일로 컬럼을 확정하기 전에는 특정 헤더를 필수로 지정하지 않는다.

### P1-3. 날짜가 없는 리뷰를 현재 시각으로 저장하지 않는다

현재 CSV 구현은 날짜 파싱 실패 시 현재 시각을 사용한다. 이는 기간별 차트를 왜곡한다.

#### 수정 권고

- 외부 리뷰의 날짜 누락은 `invalid` 또는 `needs_correction`
- 사용자가 날짜를 직접 확인해야 commit 가능
- `imported_at`과 `occurred_at`을 절대 혼용하지 않음
- 날짜만 존재하면 Asia/Seoul 정오로 정규화해 DST/UTC 날짜 이동 방지

### P1-4. reviewer hash는 일반 SHA가 아니라 조직별 HMAC을 사용한다

짧은 닉네임은 일반 해시만 저장하면 사전 대입으로 복원하기 쉽다.

#### 수정 권고

`HMAC-SHA256(server_secret, organization_id + normalized_nickname)`을 사용한다. 화면에 닉네임을 표시할 필요가 없다면 원문은 저장하지 않는 옵션도 제공한다.

### P1-5. AI 수정값과 모델 원본을 분리한다

“AI 결과를 사람이 수정할 수 있다”는 요구와 분석 테이블의 append-only 구조가 충돌한다.

#### 수정 권고

- `feedback_analyses`: 모델 원본, 불변
- `feedback_analysis_overrides`: 사람이 수정한 감성·테마·긴급도
- 화면과 집계는 override가 있으면 우선 적용
- 수정자·수정 시각·사유 기록

### P1-6. 원문 삭제·수정 감지는 수동 가져오기 방식의 한계를 표시한다

CSV·붙여넣기만으로는 플랫폼에서 삭제된 리뷰를 자동으로 알 수 없다.

#### 수정 권고

- `마지막 확인 시각`과 `수집 방식` 표시
- 수동 수집 리뷰에 “원문 변경 자동 확인 안 됨” 안내
- 공식 API 도입 후에만 `source_deleted_at` 자동 동기화
- 사용자가 숨김 처리할 때 원문 삭제와 로컬 숨김을 구분

### P1-7. 집계 기준 시간을 KST로 고정한다

기간별 리뷰 수가 UTC 경계로 하루씩 이동할 수 있다.

#### 수정 권고

- API 입력은 `YYYY-MM-DD`
- DB 집계는 `occurred_at at time zone 'Asia/Seoul'`
- 일·주·월 경계를 한국 시간으로 계산
- 주간 시작 요일은 월요일로 통일

## 5. P2 — 후속 개선 항목

- 채널별 답글 링크 템플릿
- 반복 이슈의 메뉴·직원·시간대 상관 분석
- 리뷰와 POS 메뉴 판매량 비교
- 부정 리뷰 급증 시 운영 알림
- 주간 요약 PDF/메일
- 원문 언어 감지 및 외국어 리뷰 번역
- 사용자가 정의하는 테마와 긴급 키워드

## 6. 수정된 권장 데이터 구조

### feedback_items 최소 확장

기존 컬럼을 최대한 유지한다.

```text
external_id       중복 저장 키: native:<id> 또는 hash:<sha256>
content_hash      내용 변경 비교용 SHA-256
source_url        허용 도메인의 원문 링크
source_updated_at 원문 수정 시각
import_method     csv | paste | ocr | api | manual
imported_at       TimeFit에 가져온 시각
reviewer_hash     조직별 HMAC
urgency           reference | normal | high | urgent
hidden_at         로컬 숨김 시각
metadata          채널별 부가 정보
```

`source_review_id`는 별도 컬럼으로 추가하지 않고 `external_id`와 `metadata.sourceNativeId`를 사용한다.

### 신규 테이블

- `review_import_previews`
- `review_import_preview_rows`
- `review_import_runs`
- `feedback_analysis_jobs`
- `feedback_analyses`
- `feedback_analysis_overrides`
- `feedback_revisions`

모든 테이블에 `organization_id`, FK, check constraint, 생성 시각, 필요한 RLS와 인덱스를 명시한다.

## 7. 수정된 API 흐름

```text
브라우저 CSV 파싱
  → 정규화 행만 preview API 전송
  → preview/preview_rows 임시 저장
  → 서버 중복 판정
  → previewId 반환
  → 사용자가 행 수정·선택
  → commit RPC/API
  → transaction으로 feedback/revision/import_run 저장
  → analysis_job 생성
  → 즉시 commit 결과 반환
  → 백그라운드 분석
  → dashboard 캐시 무효화
```

OCR은 이미지 업로드 후 서버 OCR을 거치되 이후 흐름은 동일하다.

## 8. UX 검토

### 잘 설계된 부분

- 가져오기 전 미리보기
- 신규·갱신·중복·오류 구분
- 자동 답글 제외
- 원문과 AI 요약 분리
- 통합 목록과 조치 업무의 분리
- 모바일 카드형 전환

### 개선 권고

1. 첫 화면의 핵심 행동은 `새 리뷰 확인`과 `리뷰 가져오기` 두 개로 제한한다.
2. 가져오기 화면에서 방식보다 채널을 먼저 고르는 현재 순서는 적절하다.
3. OCR은 정확도가 낮으므로 `권장`이 아니라 `보조 수단`으로 표시한다.
4. 평점이 없는 리뷰는 별점 영역을 숨기고 감성 칩을 강조한다.
5. 중복 행은 기본 접힌 상태로 두고 `중복 12건`에서 펼쳐보게 한다.
6. 긴급 리뷰는 빨간색만 사용하지 않고 `긴급` 텍스트와 원인을 함께 표시한다.
7. AI 신뢰도가 낮은 결과는 `분석 확인 필요`로 표시한다.

## 9. 성능 검토

### 권장 제한

| 항목 | 제한 |
|---|---:|
| CSV 파일 | 5MB |
| 단일 가져오기 | 1,000행 |
| OCR 이미지 | 10장, 장당 10MB |
| 목록 페이지 | 50건 |
| 분석 배치 | 10~20건 |
| preview 유효기간 | 30분 |
| OCR 파일 보관 | 최대 24시간 |

### 캐시

- 목록: 5분 캐시보다 stale-while-revalidate 적용 권장
- 대시보드: 조직·기간·채널·필터 조합 키
- 가져오기, 상태 변경, override 저장 시 관련 키만 무효화
- 브라우저 탭 이동 시 전체 재로딩 금지

## 10. 테스트 보완

기존 테스트 설계에 다음 사례를 추가한다.

- 같은 원본 ID인데 본문만 수정된 리뷰
- 원본 ID가 없는 동일 본문의 다른 작성일 리뷰
- 평점이 없는 네이버 리뷰만 있는 기간
- 캐치테이블 세부 평점 컬럼
- CSV 날짜 누락 및 상대 날짜(`어제`, `3일 전`)
- 1,000행 preview의 요청 크기·처리 시간
- 만료된 preview commit 차단
- 다른 조직의 previewId 접근 차단
- commit 요청 중 네트워크 단절 후 재시도
- 리뷰 본문에 모델 명령문이 포함된 경우
- OCR 이미지 삭제 작업 실패 후 재정리
- 분석 override가 집계에 우선 반영되는지 확인
- KST 자정 전후 리뷰의 일별 집계

실제 고객 리뷰 대신 구조만 동일한 합성 fixture를 테스트에 사용한다.

## 11. 개발 착수 순서 수정안

### 단계 0 — 샘플 확정

- 네이버·캐치테이블에서 합법적으로 확보한 샘플 CSV 또는 사용자가 직접 복사한 예시 각각 10건
- 실제 컬럼과 평점 유무 확인
- 저장하지 말아야 할 개인정보 확인

### 단계 1 — 기반 구조

- permission constraint와 관리 UI
- DB 확장 및 preview/import/analysis 테이블
- 서버 authorization 및 RLS
- SHA-256/HMAC 유틸

### 단계 2 — 가져오기

- 공통 parser interface
- 네이버·캐치테이블 CSV/paste adapter
- preview/commit API
- 멱등성·revision
- 가져오기 UI

### 단계 3 — 목록과 조치

- 페이지네이션 목록
- 상세·처리 상태·메모
- 긴급 키워드 규칙
- 원문 링크 안전 검사

### 단계 4 — 분석과 대시보드

- analysis jobs/worker
- Structured Outputs 분석
- override
- KST 집계 RPC와 차트

### 단계 5 — OCR

- 이미지 품질 검사
- private storage와 TTL 삭제
- OCR parser 및 사용자 확인

OCR을 1차 첫 단계에서 분리하면 가장 신뢰도가 높은 CSV/paste 기능을 먼저 안정화할 수 있다.

## 12. 최종 권고

다음 조건으로 구현을 시작하는 것이 적절하다.

1. 크롤러가 아니라 **사용자 주도 가져오기**를 1차 제품으로 확정한다.
2. 기존 `external_id`를 단일 중복 키로 유지한다.
3. preview는 DB 임시 세션으로 처리한다.
4. 리뷰 저장과 AI 분석을 비동기로 분리한다.
5. 신규 permission 코드·RLS·관리 화면을 동시에 배포한다.
6. 네이버·캐치테이블 샘플 데이터로 파서를 확정한 뒤 OCR을 추가한다.

이 수정안을 적용하면 현재 TimeFit 구조 안에서 안전하게 구현할 수 있으며, 월 수백 건 규모에서는 기존 인프라 안에서 충분히 운영 가능하다.
