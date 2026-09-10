# TimeFit 네이티브 태블릿 포팅 아키텍처 및 구현 계획

## 1. 목표

현재 웹 `/tablet` 화면을 Flutter 네이티브 앱으로 포팅해 매장 태블릿에서 안정적인 터치 입력, 장시간 운영, 오프라인 복구, 안전한 관리자 연결을 제공한다.

대상 플랫폼은 Android 태블릿과 iPad를 우선으로 하며, 동일한 코드베이스에서 사업장별 태블릿 기기를 운영한다.

## 2. 범위

### 포함

- 관리자 로그인 기반 사업장 연결
- 기기 토큰 발급·보관·만료·연결 해제
- 전화번호 뒷 4자리 출퇴근 조회 및 출근·퇴근 저장
- 전화번호 뒷 8자리 휴가 신청
- 관리자 승인 대기 데이터 반영
- 로딩, 성공, 실패, 네트워크 재시도 모달
- 대형 터치 UI와 가로·세로 태블릿 레이아웃
- 앱 재실행 후 사업장 연결 상태 복구
- 운영 로그와 오류 추적

### 제외 또는 후순위

- 카카오 알림톡 실제 발송 연동
- QR 촬영 방식
- 급여·세무 기능
- 다중 태블릿 간 실시간 WebSocket 동기화
- 앱스토어 제출 자동화

## 3. 권장 아키텍처

```text
Flutter Tablet App
 ├─ Presentation
 │   ├─ SetupScreen
 │   ├─ AttendanceScreen
 │   ├─ LeaveRequestScreen
 │   └─ Shared dialogs/loading/error states
 ├─ Application
 │   ├─ TabletConnectionController
 │   ├─ AttendanceController
 │   └─ LeaveRequestController
 ├─ Domain
 │   ├─ TabletDevice
 │   ├─ EmployeeLookup
 │   ├─ AttendanceRecord
 │   └─ LeaveRequest
 ├─ Infrastructure
 │   ├─ Supabase RPC client
 │   ├─ Secure token storage
 │   ├─ Connectivity monitor
 │   └─ Local retry queue
 └─ Platform
     ├─ Android kiosk / screen keep-awake
     └─ iPad guided-access 대응
```

Flutter UI와 Supabase 호출 사이에 Application/Domain 계층을 두어, 웹 화면과 DB RPC가 직접 결합되지 않도록 한다.

## 4. 데이터·API 설계

### 기기 연결

1. 관리자가 이메일·비밀번호로 로그인한다.
2. `timefit_user_get_manager_tablet_organization`으로 관리자 사업장을 확인한다.
3. `timefit_user_activate_tablet_device`로 기기 토큰을 발급한다.
4. 앱은 토큰을 Secure Storage에 저장하고 관리자 세션은 즉시 로그아웃한다.
5. 이후 모든 태블릿 RPC는 기기 토큰만 사용한다.

### 출퇴근

- 조회: `timefit_user_tablet_attendance_v2`
- 입력: `phoneLast4`, `action=lookup|check_in|check_out`
- 성공 시 직원명, 다음 액션, 기록 ID를 반환한다.
- 중복 출근·퇴근은 서버에서 거부한다.

### 휴가 신청

- 저장: `timefit_user_tablet_leave_request_v2`
- 입력: `phoneLast8`, `startsOn`, `endsOn`, `leaveType`
- 서버에서 직원 존재 여부, 날짜 유효성, 정기휴일·공휴일, 잔여 연차를 검증한다.
- 신청 저장과 관리자 알림 로그는 하나의 트랜잭션으로 처리한다.

## 5. 보안 설계

- 관리자 비밀번호를 로컬에 저장하지 않는다.
- 기기 토큰은 평문 저장 대신 OS Secure Storage를 사용한다.
- 기기 토큰에는 만료일과 active/revoked 상태를 적용한다.
- 앱 로그에 이메일, 전화번호 전체, 토큰, 비밀번호를 남기지 않는다.
- 기기 연결 해제 시 로컬 토큰을 삭제하고 서버 상태를 revoked로 변경한다.
- 서버 RPC는 기기 토큰과 사업장 상태를 매번 검증한다.

## 6. 화면 설계

### SetupScreen

- 사업장명/기기명
- 관리자 이메일·비밀번호
- 연결 중 로딩 상태
- 연결 성공·권한·네트워크 오류 모달

### AttendanceScreen

- 큰 숫자 키패드 또는 숫자 입력
- 뒷 4자리 직원 조회
- 직원 확인 모달
- 출근하기·퇴근하기 버튼
- 성공 후 입력값 초기화

### LeaveRequestScreen

- 뒷 8자리 입력
- 날짜 선택 캘린더
- 연차·오전 반차·오후 반차 카드 선택
- 신청 전 요약 확인
- 성공 시 신청 번호와 관리자 승인 대기 상태 표시

## 7. 구현 순서

### Phase 0 — 기반 정리

- Flutter 프로젝트 생성 및 Android/iPad 빌드 설정
- 환경 변수 분리
- 디자인 토큰·태블릿 브레이크포인트 정의
- Supabase 초기화 모듈 작성

### Phase 1 — 기기 연결

- SetupScreen 구현
- 관리자 로그인 RPC 연결
- 기기 토큰 Secure Storage 저장
- 앱 재실행 복구·연결 해제 구현

### Phase 2 — 출퇴근

- 숫자 키패드 UI 구현
- 직원 조회 RPC 연결
- 확인 모달 및 출근·퇴근 저장 RPC 연결
- 중복 입력·네트워크 재시도 처리

### Phase 3 — 휴가 신청

- 날짜 캘린더 구현
- 휴가 종류 선택 카드 구현
- 휴가 신청 RPC 연결
- 공휴일·정기휴일·연차 잔여 오류 메시지 매핑

### Phase 4 — 운영 안정화

- 앱 장시간 실행 및 화면 꺼짐 방지
- 네트워크 단절 배너·재시도
- 제출 중 중복 탭 방지
- 접근성 폰트·터치 영역 검증
- 오류 로그와 Crashlytics/Sentry 연동 검토

### Phase 5 — 관리자 연동 검증

- 관리자 웹에서 출퇴근 기록 확인
- 관리자 웹에서 휴가 신청 대기 건 확인
- 승인·반려 후 태블릿 상태 확인
- 다른 사업장 데이터가 노출되지 않는지 검증

### Phase 6 — 스토어·현장 배포

- Android APK/AAB 및 iOS archive 빌드
- 태블릿 실기기 테스트
- 키오스크/Guided Access 운영 가이드 작성
- 내부 테스트 배포 후 스토어 제출 준비

## 8. 테스트 기준

### 기능 테스트

- 최초 연결, 재실행 복구, 연결 해제
- 정상 직원 출근·퇴근
- 미등록 번호, 중복 출근, 이미 퇴근한 직원
- 정상 휴가 신청, 공휴일 차단, 잔여 연차 부족
- 관리자 승인·반려 반영

### 디바이스 테스트

- 8~13인치 Android 태블릿
- iPad 가로·세로 모드
- 소프트 키보드 미노출 또는 앱 내 키패드 사용
- 장시간 화면 유지
- 네트워크 끊김 후 복구

### 보안 테스트

- 토큰 만료·폐기
- 로그아웃 후 사업장 데이터 접근 차단
- 다른 사업장 직원 번호 조회 차단
- 앱 로그 민감정보 노출 여부

## 9. 완료 조건

- Android/iPad Release 빌드 성공
- 운영 Supabase RPC를 통한 출퇴근·휴가 저장 성공
- 관리자 웹에서 두 데이터 모두 확인 가능
- 네트워크 오류와 서버 오류가 사용자 친화적 모달로 표시
- 테스트 계정·테스트 직원으로 전체 시나리오 통과
- 태블릿 실기기 2종 이상에서 터치·회전·장시간 실행 통과
