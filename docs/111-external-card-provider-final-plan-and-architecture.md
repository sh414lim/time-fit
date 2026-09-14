# TimeFit 외부 법인카드 Provider 기반 최종 개발 기획·설계

버전: 2.0

작성일: 2026-09-12

상태: 개발 기준안
대상: 레오핏테크의 멀티테넌트 SaaS TimeFit

## 1. 최종 의사결정

TimeFit은 카드사별 스크래핑·금융정보 수집 엔진을 직접 개발하거나 운영하지 않는다. 실제 카드 연결과 내역 수집은 CODEF, Hyphen 등 계약된 외부 금융 데이터 Provider가 담당한다.

TimeFit이 소유할 범위:

- 고객사·사용자·권한·동의 이력
- Provider 연결 UX와 상태 관리
- Provider 교체가 가능한 표준 Adapter
- 카드·승인·취소·매입 이벤트 정규화
- 영수증 OCR, 거래 매칭, 중복 방지, 지출 원장
- 매출·인건비 연동, 일·주·월·연 결산과 보고서
- 예외 처리와 감사 로그

Provider가 담당할 범위:

- 카드사별 인증·인증서/계정 연계
- 보유카드 조회
- 승인·취소·부분취소·매입·청구 원천 데이터
- 카드사 사이트 변경 대응과 수집 인프라

화면의 `법인카드 연결`은 TimeFit이 카드사를 직접 호출한다는 의미가 아니라, 고객 동의를 받아 계약 Provider의 인증·조회 기능을 TimeFit 안에서 중개한다는 의미다.

## 2. 제품 목표와 출시 범위

> 고객사가 법인카드를 연결하면 카드와 내역이 자동 동기화되고, 촬영한 영수증은 한 지출에 자동 연결되며, 관리자는 예외만 처리해 운영손익과 결산보고서를 완성한다.

1차 출시 범위:

- 운영 Provider 1곳, 추가 Provider가 가능한 Adapter 구조
- 금융정보 처리 동의, 사업자 유형과 지원 카드사 안내
- 인증 시작, 보유카드 조회·선택, 담당자·매장 지정
- 최근 90일 백필과 정기 증분 동기화
- 승인·전체취소·부분취소·매입 정규화
- 연결 상태·데이터 기준시각·재인증·해제
- CSV 수동 가져오기 폴백
- 영수증 촬영·업로드, Google Vision OCR, LLM 구조화
- 카드 거래 매칭·예외 검토·단일 지출 원장
- 매출·인건비 결합, 일간·주간·월간·연간 보고
- 운영순익 차트, 마감·재오픈, PDF·Excel

제외 범위:

- 카드사별 자체 스크래핑
- 전체 카드번호, CVC, 카드 비밀번호 저장
- 카드 결제·송금
- 금융 수집 API의 외부 재판매
- 세금 신고서 작성·전자신고

## 3. 목표 아키텍처

```text
[고객사 관리자: 동의·인증·카드 선택]
                    │
                    ▼
       [TimeFit Card Connection API]
                    │
            [Provider Adapter]
         ├─ CODEF  ├─ Hyphen  └─ Mock/CSV
                    │
                    ▼
[Sync Queue/Worker] → [불변 카드 이벤트] → [거래 그룹]
                                               │
[직원 영수증] → Storage → Vision → LLM → 검증·매칭
                                               │
                                               ▼
                                          [지출 원장]
                                               │
                         Toss 매출 + 실제 인건비 ─┤
                                               ▼
                              [일·주·월·연 결산/보고]
```

원칙:

- UI와 원장은 Provider 원문 필드에 의존하지 않는다.
- Provider별 차이는 Adapter 안에서 표준 모델로 변환한다.
- Provider 장애가 근태·매출·수기 지출과 기존 보고를 막지 않는다.
- 원천 이벤트는 수정하지 않고 정정 이벤트를 추가한다.
- 확정 결산은 snapshot으로 고정한다.
- 비밀정보는 브라우저와 일반 DB에 평문으로 두지 않는다.

## 4. Provider Adapter 계약

```ts
interface CorporateCardProvider {
  capabilities(): ProviderCapabilities
  beginAuthentication(input): Promise<AuthenticationSession>
  completeAuthentication(input): Promise<CredentialReference>
  listCards(connection): Promise<ProviderCard[]>
  fetchApprovals(query): Promise<ProviderPage<CardEvent>>
  fetchAcquisitions(query): Promise<ProviderPage<CardEvent>>
  fetchBilling?(query): Promise<ProviderPage<CardEvent>>
  health(connection): Promise<ProviderHealth>
  revoke(connection): Promise<void>
  classifyError(error): ProviderError
}
```

필수 capability는 보유카드, 승인, 취소, 매입, 기간/페이지 조회, 재인증 상태, 원승인-취소 연결키다. 청구서·결제예정액·한도·webhook은 선택 기능으로 둔다.

Provider 선정 Go 조건:

- TimeFit 최종 고객에게 데이터 제공·보관·결산 활용이 계약상 허용됨
- 핵심 카드사와 법인 유형 지원
- 테스트베드·운영키·실제 명세·오류코드 제공
- 승인·취소·매입의 안정적인 식별자 제공
- 고객 인증정보를 TimeFit 평문 DB에 보관하지 않는 방식
- 호출 제한·단가·SLA·카드사 변경 대응 범위 명시

## 5. 멀티테넌트·보안

모든 금융 객체는 `organization_id`를 직접 가진다. RLS뿐 아니라 서버 API, Queue payload, Storage path에서도 조직을 재검증한다.

| 역할 | 허용 범위 |
|---|---|
| 소유자 | 동의, 연결·재인증·해제, 마감·재오픈 |
| 비용관리자 | 전체 지출·증빙·카드, 분류·확정, 보고서 |
| 카드담당자 | 담당 거래, 사유·영수증 제출 |
| 직원 | 본인에게 요청된 증빙 제출·조회 |
| 조회자 | 승인된 확정 원장·보고서 |
| TimeFit 운영자 | 원문 금융정보 기본 접근 불가 |

보안 필수사항:

- Provider service key는 서버 비밀값, 고객 credential은 Provider token/Vault reference
- PAN은 수신 즉시 폐기하고 provider asset ID, issuer, last4만 저장
- 인증서·비밀번호·token·PAN 로그 마스킹
- 동의 전문 version/hash, 목적, 보존기간, 철회 기록
- 해제 시 credential reference 폐기, 과거 거래·감사·결산은 보존정책에 따라 유지
- 운영자 접근은 고객 승인과 break-glass 감사 절차 적용

## 6. 데이터 모델과 무결성

```text
card_connections
└─ connection_assets
   └─ corporate_cards
      ├─ card_sync_runs/cursors
      └─ card_transaction_events
         └─ card_transaction_groups

expense_documents ─ processing_runs
expense_sources ─ expense_matches ─ expenses
closeouts ─ closeout_lines/report_artifacts
```

필수 제약:

- 활성 연결: `(organization_id, provider, provider_tenant_key)` partial unique
- 카드: `(organization_id, provider, provider_asset_id)` unique
- 이벤트: `(organization_id, provider, provider_event_id)` unique
- 안정 ID가 없으면 조직·Provider·카드·승인번호·시각·금액·유형의 HMAC 멱등 키 사용
- 영수증: `(organization_id, sha256)` 중복 검사
- 카드 거래 그룹과 영수증은 각각 하나의 활성 expense에만 primary source가 될 수 있음
- 연결·카드 삭제가 거래·원장·결산을 cascade 삭제하지 않음

## 7. 중복 방지·거래 생명주기

카드 거래와 영수증은 각각 지출이 아니라 `expense_source`다. 매칭 확정 시 두 source가 같은 expense에 연결된다.

```text
거래 순액 = 승인액 - 전체/부분 취소액
월 확정 지출 = 매입액 우선
미매입 승인액 = 잠정 지출
```

승인, 취소, 매입을 별도 지출로 더하지 않는다. 수집은 Provider event ID, 원문 checksum, overlap 조회, 성공 페이지별 cursor로 멱등성을 보장한다.

매칭 우선순위:

1. 승인번호
2. 카드 last4/담당자
3. 총액
4. 거래일시
5. 사업자번호 또는 정규화 상호

자동 연결은 고신뢰·미마감·단일 후보일 때만 허용하며 기본 정책은 추천이다. 금액 불일치, 복수 후보, 부분취소, 마감 거래는 관리자 검토로 보낸다.

## 8. 연결·동기화 UX

주 CTA는 `법인카드 연결`, 보조 CTA는 `CSV로 내역 가져오기`다.

```text
Provider/지원 카드사 안내
→ 수집·이용 동의
→ 사업자 유형 선택
→ Provider 인증
→ 보유카드 조회
→ 카드 선택
→ 담당자·매장·기본 분류
→ 최근 90일 가져오기
→ CSV 일별 합계 대조
→ 자동 동기화 활성화
```

`실시간`이라는 표현 대신 연결 상태, 최근 정상 동기화, 데이터 기준시각, 다음 동기화, 영향 카드·기간을 표시한다. 상태는 `연결됨/동기화 중/일부 지연/재인증 필요/일시중지/해제됨`으로 통일한다.

동기화 정책:

- 최초 90일을 기간·페이지 job으로 분할
- 기본 6시간, 계약 비용·rate limit 내 활성 고객만 1~3시간
- 야간 최근 7일 overlap, 월초 전월 매입·청구 대조
- 429/5xx는 지수 backoff+jitter
- 인증 오류는 무한 재시도하지 않고 `reauth_required`
- Provider 장애 시 다른 고객·카드 job은 계속 처리

## 9. 영수증·지출·결산

```text
촬영/갤러리/PDF
→ 품질 검사
→ 비공개 Storage
→ Google Vision OCR
→ LLM JSON Schema
→ 서버 규칙 검증
→ 카드 후보 매칭
→ 추천/확정/예외
→ 단일 지출 원장
```

직원은 사진과 짧은 목적만 제출한다. 관리자는 저신뢰 OCR, 미증빙, 금액 차이, 중복 의심, 복수 후보만 처리한다. OCR/LLM 장애 시 원본을 유지하고 재처리 이력을 추가한다.

```text
순매출 = 총매출 - 매출취소 - 할인
운영순익(추정) = 순매출 - 확정 운영지출 - 실제 인건비
```

- 일간: 매출·잠정/확정 지출·인건비·운영순익·예외
- 주간: 일별 추이·전주 대비·상위 지출·예상/실제 인건비 차이
- 월간: 순익·비용구성·승인/취소/매입·증빙률·마감
- 연간: 월별 추이·전년 비교·거래처/카드/직원별 합계·감사 이력

웹, 차트, PDF, Excel은 동일 집계 API와 `snapshot_version`을 쓴다.

## 10. 개발 로드맵

### Phase 0 — 계약·명세 확정 (외부 일정)

- CODEF/Hyphen 견적·지원 범위·비용 비교
- 인증 방식, 재제공/보관/결산 권리 확인
- 테스트베드, endpoint, fixture, 오류코드, rate limit, SLA 수령
- 1차 운영 Provider와 예비 Provider 선정

완료: 실제 명세와 계약 조건이 서면 확정됨.

### Phase 1 — Provider 독립 기반 강화 (1주)

- 기존 Hyphen placeholder를 계약 명세 전까지 mock 경계로 격리
- `providerAssetId`의 전체 카드번호 fallback 제거
- capability/error taxonomy/contract test
- credential을 token/Vault reference 우선으로 변경
- 조직 A/B API·RLS·Storage·Queue 격리 테스트

완료: Mock 연결→카드 발견→90일 백필→원장 E2E, PAN/secret 저장 0건.

### Phase 2 — 계약 Provider Sandbox (2주)

- 서비스 인증·고객 인증 세션
- 보유카드 discovery와 선택
- 승인·취소·매입 normalizer
- pagination, cursor, rate limit, 재인증
- fixture contract/regression test

완료: 동일 이벤트 3회 재수집 후 건수·합계 불변.

### Phase 3 — 동기화 운영화 (1~2주)

- Queue/Worker lease, retry, dead-letter
- 백필 진행률과 정기·overlap·월간 대조
- Provider 비용·오류·freshness 모니터링
- 연결 상태·복구 UX

완료: 부분 실패 지점부터 재개하고 다른 조직 job을 방해하지 않음.

### Phase 4 — 영수증·원장 통합 검증 (1주)

- 촬영→Vision→LLM→매칭 E2E
- 카드+영수증 단일 expense 제약
- 부분취소·복수 영수증·반려/재제출 테스트

완료: 대표 실물 영수증에서 중복 지출·오매칭 0건.

### Phase 5 — 결산·보고 검증 (1주)

- 매출·인건비·지출 대사
- 일·주·월·연 보고·순익 차트
- snapshot·재오픈·후발 취소 조정
- PDF·Excel·원장 drill-down

완료: 화면·차트·PDF·Excel 합계 동일, 마감본 불변.

### Pilot — 실제 고객사 병행 운영 (최소 2주)

- 동의한 고객사 1곳, 카드 1~3장
- Provider와 카드사 CSV 일별 순액 대조
- 취소·부분취소·지연매입·재인증 검증
- 장애→CSV→복구 훈련

출시 게이트: 오합산 0건, 중복 0건, 교차 조직 노출 0건, P0/P1 장애 0건.

## 11. Provider 미확정 중 가능한 개발

- Adapter와 mock contract test
- 권한·RLS·감사 로그
- Queue/Worker, cursor, 멱등 처리
- CSV importer와 대사 화면
- provider-neutral 연결 wizard
- OCR·매칭·지출 원장
- 결산·보고 검증

실제 명세를 추측해 endpoint나 인증 필드를 하드코딩하지 않는다. 계약 전에는 mock/fixture 경계를 완성하고, 명세 수령 후 Adapter만 구현한다.

## 12. 운영 KPI·비용 통제

- 동기화 성공률·p95 지연·데이터 신선도
- 카드/조직/1,000건당 Provider 비용
- 중복 차단·오합산 건수
- 영수증 추천률·확정률·오매칭률
- 미증빙률·평균 제출시간
- 관리자 100건당 처리시간
- 재인증률·평균 복구시간

기본 동기화는 6시간으로 시작하고 실제 단가·사용량에 따라 고객 플랜별 주기를 조정한다. 수동 동기화에는 cooldown과 조직별 quota를 둔다.

## 13. 출시 체크리스트

- [ ] Provider 계약과 데이터 이용 범위 서면 확인
- [ ] 운영/테스트 키와 실제 명세 수령
- [ ] PAN fallback 제거
- [ ] credential token/Vault reference 적용
- [ ] 승인·취소·부분취소·매입 contract test
- [ ] 동일 범위 3회 동기화 멱등성 확인
- [ ] 조직 A/B 교차 접근 공격 테스트
- [ ] 연결 해제 후 credential 파기·과거 원장 보존
- [ ] 카드+영수증 단일 지출 제약 확인
- [ ] 장애와 CSV 폴백 복구 확인
- [ ] 화면·차트·PDF·Excel 대사
- [ ] 2주 Pilot 게이트 통과

## 14. 문서 우선순위

이 문서는 외부 Provider 사용 결정 이후 카드 연동 개발의 최상위 기준이다.

- 지출·증빙 전체 범위: `70-expense-evidence-final-approved-plan-and-roadmap.md`
- Provider 구현 상세: `67-expense-card-development-roadmap-and-implementation-spec.md`
- 멀티테넌트 시나리오: `102-multitenant-card-expense-plan-review-and-development-scenarios.md`
- 현재 구현 상태: `110-current-development-status-and-roadmap.md`

`105`~`109`의 자체 카드사 Connector/스크래핑 계획과 충돌할 경우 이 문서를 우선한다. 해당 문서는 조사 이력으로만 유지한다.
