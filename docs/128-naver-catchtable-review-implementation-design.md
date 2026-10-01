# 네이버·캐치테이블 리뷰 관리 기능 구현 설계

> 상태: 이전 초안. `사용자의 반복 작업 0` 요구사항에 따라 수동 CSV·붙여넣기·OCR을 핵심 경로로 사용하지 않는다. 최신 수집 원칙과 구현 기준은 `130-zero-touch-review-collection-architecture.md`를 따른다.

## 1. 설계 목표

네이버 플레이스와 캐치테이블 리뷰를 TimeFit의 기존 `리뷰 · 컴플레인` 도메인에 통합한다.

- 채널별 리뷰를 동일한 데이터 구조로 저장한다.
- 가져오기 전에 신규·갱신·중복·오류 건수를 미리 확인한다.
- 같은 리뷰를 반복해서 가져와도 중복 생성하지 않는다.
- 리뷰의 감성, 테마, 긴급도를 자동 분석한다.
- 기간·채널·평점·테마별 현황을 그래프와 표로 제공한다.
- 낮은 평점과 위생·안전·결제 관련 리뷰를 업무 목록으로 전환한다.
- 플랫폼의 공식 허가가 없는 자동 크롤링은 실행되지 않게 한다.

## 2. 구현 범위

### 2.1 이전 1차 구현 범위(비상 복구 수단으로만 유지)

- 네이버 CSV/텍스트 붙여넣기/화면 캡처 가져오기
- 캐치테이블 CSV/텍스트 붙여넣기/화면 캡처 가져오기
- 채널별 파서 및 공통 정규화
- 가져오기 미리보기
- 중복 제거 및 수정 리뷰 갱신
- 통합 리뷰 목록
- 기간·채널·평점·처리 상태 필터
- 감성·테마·긴급도 분석
- 리뷰 현황 카드와 추이 차트
- 관리자 처리 상태 및 메모

위 항목은 정기 운영 흐름에서 제거한다. 공식 연동 장애 시 소유자가 명시적으로 선택하는 복구 도구로만 제공하며, 제품의 정상 동작이나 데이터 최신성은 이 입력에 의존하지 않는다.

### 2.2 핵심 구현 범위

- 네이버 또는 캐치테이블이 승인한 공식 API·제휴 연동
- 공식 API의 서버 측 증분 동기화와 자동 재시도
- 원문 수정·삭제 상태 동기화
- 연동 상태·마지막 성공 시각·재인증 필요 여부 표시

### 2.3 제외 범위

- 로그인 쿠키를 서버에 저장하는 방식
- CAPTCHA 자동 처리
- 프록시 또는 IP 순환
- 모바일 앱의 비공개 API 호출
- robots 또는 플랫폼 차단 정책 우회
- 외부 리뷰에 자동으로 답글 게시

## 3. 사용자 구조

`리뷰 · 컴플레인`을 다음 네 개의 하위 탭으로 구성한다.

1. **리뷰 현황**
2. **전체 리뷰**
3. **리뷰 가져오기**
4. **조치 관리**

### 사용자 권한

| 역할 | 현황 조회 | 가져오기 | 분석 재실행 | 조치 메모 | 삭제/숨김 |
|---|---:|---:|---:|---:|---:|
| 사업장 소유자 | 가능 | 가능 | 가능 | 가능 | 가능 |
| 재무·운영 관리자 | 가능 | 권한 설정 | 권한 설정 | 가능 | 불가 |
| 일반 관리자 | 가능 | 불가 | 불가 | 가능 | 불가 |

신규 권한 코드는 다음과 같다.

- `reviews.view`
- `reviews.import`
- `reviews.manage`

## 4. 전체 시스템 구조

```text
네이버/캐치테이블
  ├─ CSV 파일
  ├─ 사용자가 복사한 텍스트
  └─ 사용자가 올린 화면 캡처
             ↓
POST /api/reviews/import-preview
             ↓
채널 파서 → 공통 정규화 → 데이터 검증 → 중복 비교
             ↓
미리보기: 신규 / 갱신 / 중복 / 오류
             ↓
POST /api/reviews/import-commit
             ↓
feedback_items + import_runs + revisions
             ↓
리뷰 분석 큐 → 감성·테마·긴급도 분석
             ↓
GET /api/reviews/dashboard
             ↓
현황 카드 / 그래프 / 리뷰 목록 / 조치 관리
```

현재 프로젝트의 `pages/api/[...route]` 단일 진입점을 그대로 사용한다. 리뷰 기능마다 Vercel Function 파일을 별도로 만들지 않는다.

## 5. 채널 어댑터 설계

### 5.1 공통 인터페이스

```ts
type ReviewImportInput = {
  source: 'naver' | 'catchtable';
  method: 'csv' | 'paste' | 'ocr';
  content: string;
  fileName?: string;
};

type NormalizedReview = {
  source: 'naver' | 'catchtable';
  sourceReviewId: string | null;
  sourceUrl: string | null;
  reviewerName: string | null;
  rating: number | null;
  content: string;
  occurredAt: string;
  sourceUpdatedAt: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
};
```

각 채널 파서는 `parse`, `normalize`, `validate` 세 단계를 제공한다.

### 5.2 네이버 파서

인식 가능한 헤더 별칭:

- 리뷰 내용: `리뷰`, `내용`, `후기`, `본문`, `방문자리뷰`
- 작성자: `작성자`, `닉네임`, `리뷰어`
- 평점: `평점`, `별점`
- 작성일: `작성일`, `등록일`, `방문일`
- 리뷰 ID: `리뷰 ID`, `reviewId`
- 원문 링크: `원문`, `링크`, `URL`

네이버 방문자 리뷰는 평점이 없는 형식도 허용한다. 평점이 없으면 감성 분석 결과만 사용하고 평균 평점 계산에서는 제외한다.

### 5.3 캐치테이블 파서

인식 가능한 헤더 별칭:

- 리뷰 내용: `리뷰`, `후기`, `내용`, `comment`
- 작성자: `닉네임`, `작성자`, `고객명`
- 평점: `평점`, `별점`, `rating`
- 작성일: `작성일`, `방문일`, `예약일`
- 리뷰 ID: `리뷰번호`, `reviewId`
- 원문 링크: `원문`, `링크`, `URL`

예약일과 작성일이 함께 있으면 작성일을 `occurred_at`으로 저장하고 예약일은 `metadata.visitDate`에 저장한다.

### 5.4 텍스트 붙여넣기

텍스트 붙여넣기는 다음 구분자를 지원한다.

- 리뷰 사이 빈 줄 2개
- `---`
- 날짜로 시작하는 리뷰 블록

파싱 신뢰도가 낮거나 날짜가 없으면 사용자에게 미리보기에서 수정하도록 요구한다.

### 5.5 화면 캡처 OCR

1. 화면 이미지에서 텍스트를 추출한다.
2. 리뷰 카드의 위치를 기준으로 블록을 분리한다.
3. 작성자·작성일·평점·본문 후보를 생성한다.
4. OCR 결과는 자동 저장하지 않고 미리보기에 표시한다.
5. 사용자가 확인한 행만 저장한다.

한 화면에 잘린 리뷰 본문은 `본문 일부`로 표시하고 원문 전체로 취급하지 않는다.

## 6. 데이터베이스 설계

### 6.1 기존 테이블 확장

`timefit_user_feedback_items`에 다음 필드를 추가한다.

```sql
alter table public.timefit_user_feedback_items
  add column if not exists source_review_id text,
  add column if not exists source_url text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists import_method text,
  add column if not exists imported_at timestamptz,
  add column if not exists content_hash text,
  add column if not exists reviewer_hash text,
  add column if not exists urgency text not null default 'normal',
  add column if not exists hidden_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
```

제약 조건:

- `import_method`: `api`, `csv`, `paste`, `ocr`, `manual`
- `urgency`: `reference`, `normal`, `high`, `urgent`
- 외부 리뷰는 `source_review_id` 또는 `content_hash` 중 하나가 반드시 존재

인덱스:

- `(organization_id, source, source_review_id)` 부분 고유 인덱스
- `(organization_id, source, content_hash, occurred_at)` 중복 탐색 인덱스
- `(organization_id, occurred_at desc)` 목록 인덱스
- `(organization_id, urgency, status)` 업무함 인덱스

기존 `external_id`는 호환성을 위해 유지한다. 신규 저장 시 `external_id = source_review_id ?? content_hash`로 기록한다.

### 6.2 가져오기 실행 기록

```sql
create table public.timefit_user_review_import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source text not null,
  method text not null,
  status text not null,
  fetched_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  failed_count integer not null default 0,
  error_code text,
  error_message text,
  requested_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

업로드 파일 원문은 실행 기록에 저장하지 않는다.

### 6.3 분석 결과

```sql
create table public.timefit_user_feedback_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  feedback_item_id uuid not null,
  sentiment text not null,
  sentiment_score numeric(5,4),
  themes jsonb not null default '[]',
  keywords jsonb not null default '[]',
  urgency text not null,
  summary text,
  model text not null,
  model_version text,
  needs_review boolean not null default false,
  analyzed_at timestamptz not null default now(),
  unique(feedback_item_id, model_version)
);
```

### 6.4 변경 이력

```sql
create table public.timefit_user_feedback_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  feedback_item_id uuid not null,
  revision_type text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
```

본문·평점·작성일이 변경된 경우만 revision을 생성한다.

## 7. API 설계

라우트 파일은 `server/routes/reviews.js` 하나로 묶는다.

| API | 메서드 | 권한 | 역할 |
|---|---|---|---|
| `/api/reviews/import-preview` | POST | `reviews.import` | 파싱·검증·중복 비교 |
| `/api/reviews/import-commit` | POST | `reviews.import` | 확인된 행 저장 |
| `/api/reviews/dashboard` | GET | `reviews.view` | 요약·차트·목록 집계 |
| `/api/reviews/:id` | GET/PATCH | `reviews.view/manage` | 상세 및 처리 상태 변경 |
| `/api/reviews/analyze` | POST | `reviews.manage` | 선택 리뷰 재분석 |
| `/api/reviews/import-runs` | GET | `reviews.manage` | 가져오기 이력 조회 |

### 7.1 미리보기 응답

```json
{
  "summary": {
    "total": 25,
    "create": 18,
    "update": 2,
    "duplicate": 4,
    "invalid": 1
  },
  "rows": [
    {
      "rowId": "preview-1",
      "action": "create",
      "review": {},
      "warnings": []
    }
  ],
  "previewToken": "signed-short-lived-token"
}
```

미리보기 데이터는 브라우저가 임의로 바꿔 저장하지 못하도록 짧은 유효기간의 서명 토큰 또는 서버 임시 레코드로 연결한다.

### 7.2 커밋 요청

```json
{
  "organizationId": "uuid",
  "previewToken": "token",
  "acceptedRowIds": ["preview-1", "preview-2"],
  "corrections": {
    "preview-2": {
      "rating": 4,
      "occurredAt": "2026-09-29T00:00:00+09:00"
    }
  }
}
```

클라이언트가 보내는 수정값은 날짜·평점·본문 길이를 다시 검증한다.

## 8. 중복 및 갱신 판정

```text
1. source_review_id 동일 → update 또는 duplicate
2. source_url 동일 → update 또는 duplicate
3. content_hash + 작성일 + 평점 동일 → duplicate
4. 작성자 해시 + 작성일 근접 + 본문 유사도 95% 이상 → duplicate_candidate
5. 그 외 → create
```

기존 값과 새 값이 모두 같으면 `duplicate`, 본문·평점·작성일 중 하나가 다르면 `update`로 판정한다.

본문 해시는 다음 정규화를 거친다.

- Unicode NFC
- 앞뒤 공백 제거
- 연속 공백 하나로 변환
- 줄바꿈 통일
- 채널 UI 문구 제거

## 9. AI 분석 설계

### 입력

- 리뷰 본문
- 평점
- 채널
- 작성일

닉네임과 원문 URL은 모델에 전달하지 않는다.

### 출력 JSON

```json
{
  "sentiment": "negative",
  "sentimentScore": -0.82,
  "themes": [
    { "name": "서비스·응대", "sentiment": "negative", "confidence": 0.91 }
  ],
  "keywords": ["대기", "응대"],
  "urgency": "high",
  "summary": "긴 대기와 직원 응대에 대한 불만",
  "needsReview": false
}
```

### 비용 통제

- 신규 또는 본문 변경 리뷰만 분석한다.
- `content_hash + model_version` 결과를 캐시한다.
- 한 요청에 여러 리뷰를 배치하되 리뷰별 JSON 결과를 분리한다.
- 분석 실패는 최대 3회 재시도한다.
- 월 분석 한도를 설정에서 지정한다.

### 긴급 규칙 우선 적용

AI 호출 전 규칙 기반으로 다음 단어를 검사한다.

- 위생: `식중독`, `이물질`, `벌레`, `상한`, `곰팡이`
- 안전: `화상`, `부상`, `미끄러짐`, `알레르기`
- 결제: `이중결제`, `과다결제`, `환불 거부`
- 분쟁: `신고`, `소비자원`, `경찰`

긴급 키워드가 있으면 AI 결과와 무관하게 `urgency = urgent`, `needs_review = true`로 저장한다.

## 10. UI 상세 설계

### 10.1 리뷰 현황

요약 카드:

- 최근 7일 신규 리뷰
- 평균 평점
- 부정 리뷰 비율
- 확인 필요
- 마지막 가져오기

그래프:

- 리뷰 수·평점 복합 추이
- 긍정·중립·부정 누적 막대
- 테마별 긍·부정 비교
- 채널별 리뷰 수

### 10.2 전체 리뷰

데스크톱 표:

| 날짜 | 채널 | 평점 | 감성 | 주요 테마 | 리뷰 요약 | 상태 |
|---|---|---:|---|---|---|---|

모바일에서는 카드형으로 전환한다. 행을 선택하면 원문, 분석 결과, 키워드, 변경 이력, 관리자 메모를 표시한다.

### 10.3 리뷰 가져오기

단계 UI:

```text
1. 채널 선택
2. 가져오기 방식 선택
3. 파일/텍스트/이미지 입력
4. 미리보기 및 오류 수정
5. 가져오기 결과
```

미리보기 표에서 `신규`, `갱신`, `중복`, `확인 필요` 색상을 구분한다. 기본 선택은 신규·갱신이며 중복은 선택하지 않는다.

### 10.4 조치 관리

- 긴급도순 정렬
- 담당자 없이도 개인 사용 가능
- `미확인 → 확인 중 → 처리 완료 → 보관` 상태
- 내부 메모와 처리 시각 기록
- 외부 답글은 원문 페이지를 새 창으로 열어 사용자가 직접 작성

## 11. 캐시 및 성능

- 리뷰 목록: React Query 또는 현재 캐시 유틸로 5분 캐시
- 현황 집계: `(organizationId, from, to, source)` 키로 10분 캐시
- 가져오기 완료 이벤트에서 관련 캐시만 무효화
- 목록은 50건 커서 페이지네이션
- 전체 본문 대신 목록 API에서 `summary`와 200자 미리보기만 반환
- 차트 집계는 DB RPC로 처리해 브라우저 전체 로딩을 방지

## 12. 보안 및 개인정보

- 업로드 파일은 브라우저에서 파싱 가능한 CSV라면 서버에 전송하지 않는다.
- OCR이 필요한 이미지만 서버로 보내고 분석 완료 후 삭제한다.
- 공개 닉네임은 UI 표시용 원문과 중복 판별용 해시를 분리한다.
- 관리자 API는 조직 ID뿐 아니라 세션의 조직 권한을 다시 확인한다.
- 원문 링크는 `https` 및 허용 도메인 목록을 검사한다.
- CSV 수식 인젝션을 막기 위해 내보내기 시 `=`, `+`, `-`, `@` 시작 셀을 이스케이프한다.
- 파일은 5MB, 이미지 10장, 한 번에 리뷰 1,000건으로 제한한다.

## 13. 오류 처리

| 오류 | 사용자 표시 | 처리 |
|---|---|---|
| 필수 열 없음 | 필요한 열 안내 | 미리보기 중단 |
| 날짜 인식 실패 | 행별 수정 요청 | 해당 행 제외 가능 |
| 평점 범위 오류 | 0~5 입력 안내 | 해당 행 수정 |
| OCR 본문 잘림 | `본문 일부` 표시 | 사용자 확인 필수 |
| 분석 실패 | 분석 대기 상태 | 백오프 재시도 |
| 중복 후보 | 기존 리뷰 비교 표시 | 기본 건너뜀 |
| 네트워크 오류 | 저장 전이면 재시도 가능 | 중복 키로 멱등성 보장 |

## 14. 테스트 설계

### 단위 테스트

- 네이버·캐치테이블 헤더 별칭 매핑
- 인용부호, 줄바꿈, 쉼표가 포함된 CSV
- 평점 없는 네이버 리뷰
- 예약일과 작성일이 모두 있는 캐치테이블 리뷰
- content hash 안정성
- 정확 중복·수정·유사 중복 판정
- 긴급 키워드 우선 판정

### API 테스트

- 비로그인 및 권한 없는 가져오기 차단
- 다른 조직 preview token 사용 차단
- 같은 commit 요청 재시도 시 중복 생성 방지
- 일부 행 실패 시 성공/실패 건수 정확성
- 숨김 리뷰의 대시보드 집계 제외

### 브라우저 시나리오

1. 네이버 리뷰 10건 중 신규 7·갱신 1·중복 2를 미리보기한다.
2. 잘못 인식된 작성일 하나를 수정한다.
3. 선택한 8건만 저장한다.
4. 현황의 신규 건수와 전체 리뷰 목록이 일치하는지 확인한다.
5. 1점 위생 리뷰가 긴급 조치 목록 맨 위에 표시되는지 확인한다.
6. 같은 파일을 다시 가져와 신규 0건으로 표시되는지 확인한다.
7. 캐치테이블 리뷰 파일에 대해 같은 과정을 반복한다.
8. 모바일에서 필터와 상세 화면을 확인한다.

## 15. 구현 순서

### Sprint 1 — 데이터와 가져오기

- DB 마이그레이션
- 공통 파서 모듈
- 네이버·캐치테이블 파서
- 미리보기/커밋 API
- 가져오기 단계 UI
- 중복 제거 테스트

### Sprint 2 — 분석과 목록

- AI 분석 작업
- 긴급 규칙
- 통합 리뷰 목록과 상세
- 필터·검색·처리 상태
- 변경 이력

### Sprint 3 — 대시보드와 운영 검증

- 집계 RPC
- 현황 카드·그래프
- 캐시와 페이지네이션
- 테스트 데이터 UAT
- 운영 배포 및 비용 모니터링

## 16. 완료 조건

- 두 채널의 CSV·텍스트·이미지 입력을 지원한다.
- 가져오기 전 신규·갱신·중복·오류 건수가 정확하다.
- 같은 입력을 반복해도 신규 리뷰가 생기지 않는다.
- 목록 합계와 대시보드 집계가 일치한다.
- 긴급 리뷰가 1분 이내 조치 목록에 표시된다.
- 모든 AI 분석 결과는 사람이 수정할 수 있다.
- 플랫폼 허가가 없는 자동 수집 설정은 활성화할 수 없다.
- 월 수백 건 기준 추가 운영비가 1,000원 이내로 유지된다.

## 17. 파일 구성안

```text
server/
  api/reviews.js
  routes/reviews.js
  domain/reviews/
    normalize-review.js
    duplicate-review.js
    classify-review.js
    adapters/
      naver-review-adapter.js
      catchtable-review-adapter.js
src/features/reviews/
  ReviewHub.jsx
  ReviewDashboard.jsx
  ReviewImportCenter.jsx
  ReviewImportPreview.jsx
  ReviewList.jsx
  ReviewDetail.jsx
  reviewApi.js
  reviewCsv.js
  review.css
supabase/migrations/
  *_review_import_and_analysis.sql
test/
  review-import.test.js
  review-api.test.js
```

기존 `FeedbackHub`는 한 번에 제거하지 않고 `ReviewHub`로 기능을 옮긴 뒤, 모든 사용자 시나리오가 통과하면 교체한다.
