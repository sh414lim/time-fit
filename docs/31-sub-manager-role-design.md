# TimeFit 총관리자·서브 관리자 권한 기능 설계

목적: 하나의 사업장 안에서 대표(총관리자)는 사업장 소유·권한·급여를 관리하고, 매장 책임자(서브 관리자)는 일상 근태 운영을 수행하도록 역할을 분리한다.

## 1. 역할 모델

| 역할 코드 | 화면 표기 | 역할 목적 |
| --- | --- | --- |
| `owner` | 총관리자 | 사업장 소유자. 권한·민감 설정·급여 마감의 최종 책임자 |
| `manager` | 서브 관리자 | 직원·스케줄·출퇴근·휴가의 일상 운영 담당 |
| `employee` | 직원 | 본인 스케줄·근태·휴가만 조회/신청 |

기존 `manager` 데이터 전환 원칙:

- 각 사업장의 기존 관리자 멤버십 중 `timefit_user_organizations.owner_id`와 일치하는 계정은 `owner`로 전환한다.
- 나머지 기존 `manager` 멤버십은 `manager`(서브 관리자)로 유지한다.
- 기존 관리자 계정이 하나뿐인 사업장은 자동으로 `owner`가 된다.

## 2. 권한 매트릭스

| 기능 | 총관리자(owner) | 서브 관리자(manager) | 직원(employee) |
| --- | --- | --- | --- |
| 사업장 기본 정보·태블릿 PIN | 조회/수정 | 조회만 | 접근 불가 |
| 직원 직접 등록·수정 | 가능 | 가능 | 불가 |
| 직원 초대 | 직원/서브 관리자 초대 가능 | 직원만 초대 가능 | 불가 |
| 서브 관리자 역할 부여/해제 | 가능 | 불가 | 불가 |
| 총관리자 양도 | 가능(확인 절차 필요) | 불가 | 불가 |
| 스케줄 생성·수정 | 가능 | 가능 | 본인 조회 |
| 출퇴근 전체 조회/수정 | 가능 | 가능 | 본인 조회 |
| 휴가 승인·반려 | 가능 | 가능 | 본인 신청/조회 |
| 급여 예상 조회 | 가능 | 선택 사항: 숨김 권장 | 불가 |
| 급여 마감·CSV 전체 다운로드 | 가능 | 불가 | 불가 |
| 사업장 삭제/결제 | 가능 | 불가 | 불가 |

## 3. 사용자 흐름

### F-01. 총관리자의 서브 관리자 초대

1. 총관리자가 `직원 관리 → 관리자 관리`를 연다.
2. `+ 서브 관리자 초대`를 누른다.
3. 대상자의 직원 고유번호(또는 이메일)를 입력하고 역할 `서브 관리자`를 확인한다.
4. 초대를 발송한다.
5. 대상자는 가입/로그인 후 `사업장 관리자 초대` 카드에서 수락한다.
6. 수락 후 사업장 A 관리자 화면으로 이동한다.

예외:

- 대상자가 이미 해당 사업장 직원이면 기존 직원 행을 유지하고 멤버십 역할만 `manager`로 승격한다.
- 다른 사업장 소유자(`owner`)는 서브 관리자로 초대할 수 없다.
- 동일한 대상에게 중복된 pending 초대는 하나만 유지한다.

### F-02. 서브 관리자 권한 운영

1. 서브 관리자가 로그인한다.
2. 홈·직원 관리·출퇴근·스케줄·휴가 메뉴가 표시된다.
3. 운영 설정은 읽기 전용으로 표시된다.
4. 급여 관리는 메뉴에서 숨긴다.
5. 직원 관리에서 직원 초대·직접 등록은 가능하지만 관리자 관리 버튼은 보이지 않는다.

### F-03. 총관리자의 권한 변경/해제

1. 총관리자가 `관리자 관리`에서 서브 관리자를 선택한다.
2. `서브 관리자 해제`를 선택하고 확인한다.
3. 대상자는 즉시 일반 직원으로 전환되거나, 직원 행이 없다면 사업장 연결이 해제된다.
4. 다음 새로고침/로그인부터 관리자 메뉴 접근이 차단된다.

권장: 마지막 총관리자 삭제·강등은 항상 차단한다.

## 4. 데이터베이스 설계

### 4.1 enum 및 멤버십

```sql
-- 기존 enum에 owner 추가
alter type public.timefit_user_role add value if not exists 'owner' before 'manager';

-- memberships.role는 owner / manager / employee를 사용
-- organizations.owner_id는 총관리자의 auth.users.id를 유지
```

권장 보조 컬럼:

```sql
alter table public.timefit_user_memberships
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
```

### 4.2 초대 테이블 확장

```sql
alter table public.timefit_user_invitations
  add column if not exists role public.timefit_user_role not null default 'employee';
```

제약:

- 초대 role은 `manager` 또는 `employee`만 허용한다.
- `owner`는 초대로 부여하지 않는다. 소유권 양도 전용 RPC를 사용한다.

### 4.3 핵심 RPC

| RPC | 호출 권한 | 목적 |
| --- | --- | --- |
| `timefit_user_create_invitation(..., p_role)` | owner: manager/employee, manager: employee만 | 역할 포함 초대 생성 |
| `timefit_user_accept_invitation(id)` | 대상 사용자 | 멤버십 생성/역할 승격, 기존 staff 연결 유지 |
| `timefit_user_change_membership_role(org, user, role)` | owner만 | manager↔employee 변경 |
| `timefit_user_remove_manager(org, user)` | owner만 | manager 해제/직원 전환 |
| `timefit_user_transfer_ownership(org, user)` | owner만 | 명시적 확인 기반 owner 변경 |

## 5. RLS 및 Edge Function 권한 설계

공통 헬퍼:

```sql
timefit_user_has_membership_role(org_id, array['owner','manager'])
timefit_user_is_owner(org_id)
```

정책 변경:

| 리소스 | 읽기 | 생성/수정 | 비고 |
| --- | --- | --- | --- |
| 직원·스케줄·근태·휴가 | owner/manager 전체, employee 본인 | owner/manager 운영 데이터, employee 본인 신청 | 현재 manager 정책을 owner 포함으로 확장 |
| 운영 설정 | owner/manager 읽기 | owner만 수정 | PIN은 UI/API 응답에서 마스킹 권장 |
| 급여 | owner만 | owner만 | 서브 관리자에게 숨김 |
| 멤버십·관리자 초대 | owner 전체 | owner만 manager 초대/변경 | manager는 employee 초대만 |
| 태블릿 Edge Function | 공개 PIN 인증 | 공개 PIN 인증 | role과 무관, 사업장 ID/PIN/번호로만 처리 |

주의: `security definer` RPC는 반드시 호출자의 `auth.uid()`와 사업장 role을 검증하고, `search_path=public`을 고정한다.

## 6. 화면/UX 설계

### 총관리자

- 사이드바: 홈, 출퇴근, 스케줄, 휴가·연차, 급여 관리, 직원 관리, **관리자 관리**, 운영 설정
- 직원 관리 상단: `+ 직원 초대`, `+ 직접 등록`
- 관리자 관리 상단: `+ 서브 관리자 초대`
- 관리자 카드: 이름, 역할, 초대 상태, 부여일, `권한 변경`/`해제`
- 위험 작업(해제·소유권 양도): 이름 재입력 또는 2차 확인 모달

### 서브 관리자

- 사이드바: 홈, 출퇴근, 스케줄, 휴가·연차, 직원 관리
- 급여 관리·관리자 관리 숨김
- 운영 설정: 읽기 전용(태블릿 URL은 복사 가능, PIN 원문은 숨김)
- 상단에 `서브 관리자` 배지 표시

### 직원

- 기존 개인 메뉴 유지
- 관리자 초대 수락 시 역할·사업장명을 명확히 표시

## 7. API 계약 예시

### 서브 관리자 초대

```json
POST /rpc/timefit_user_create_invitation
{
  "p_organization_id": "uuid",
  "p_employee_code": "A1B2C3D4E5",
  "p_department": "매장운영",
  "p_job_title": "매장 매니저",
  "p_role": "manager"
}
```

응답:

```json
{
  "id": "uuid",
  "organization_id": "uuid",
  "target_user_id": "uuid",
  "role": "manager",
  "status": "pending"
}
```

## 8. 수용 테스트 케이스

| ID | 우선순위 | 시나리오 | 기대 결과 |
| --- | --- | --- | --- |
| SUB-01 | P0 | owner가 직원 계정을 서브 관리자로 초대 | pending 초대에 role=manager 저장 |
| SUB-02 | P0 | 대상자가 초대 수락 | 사업장 멤버십 role=manager 생성/승격 |
| SUB-03 | P0 | 서브 관리자 로그인 | 운영 메뉴 표시, 급여·관리자 관리 미표시 |
| SUB-04 | P0 | 서브 관리자의 직원·스케줄·휴가 운영 | CRUD와 승인 처리 가능 |
| SUB-05 | P0 | 서브 관리자의 운영 설정 수정/급여 URL 접근 | 403 또는 읽기 전용, 수정 불가 |
| SUB-06 | P0 | owner가 서브 관리자 해제 | 대상은 즉시 관리자 접근 불가 |
| SUB-07 | P1 | 기존 직원→서브 관리자 승격 | 기존 staff ID·전화·근태·휴가 유지 |
| SUB-08 | P1 | owner 소유권 양도 | 새 owner만 민감 관리 기능 접근 |
| SUB-09 | P0 | 다른 사업장 owner/manager 데이터 접근 | RLS로 차단 |
| SUB-10 | P1 | 마지막 owner 해제 시도 | 차단 및 안내 표시 |

## 9. 구현 순서

1. DB migration: role enum, 기존 멤버십 backfill, invitation role, RLS/RPC
2. Edge Function/RPC 단위 테스트: 초대, 수락, 역할 변경, 권한 거부
3. 프론트 권한 가드: 역할별 내비게이션·라우팅·버튼
4. 관리자 관리 UI와 서브 관리자 초대/해제 UI
5. 운영 설정 읽기 전용·급여 메뉴 숨김
6. SUB-01~SUB-10 브라우저 E2E 및 RLS 교차 테스트

## 10. 출시 판정

서브 관리자 기능 포함 출시 조건:

- SUB-01~SUB-06, SUB-09 모두 PASS
- owner와 manager의 민감 권한 차이가 UI와 API/RLS에서 동시에 차단됨
- 기존 총관리자·직원 데이터가 migration 후 유지됨
- 권한 변경 뒤 새로고침/재로그인에서도 즉시 반영됨
