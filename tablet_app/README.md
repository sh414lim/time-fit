# TimeFit Native Tablet

Flutter 기반 태블릿 전용 클라이언트의 1차 포팅 구조입니다.

## 실행

```bash
flutter pub get
flutter run
```

운영 Supabase URL·publishable key와 모바일 앱 주소는 기본값으로 포함되어 있어
일반 `flutter run`·`flutter build apk`에서도 직원 조회와 QR 호출이 동작합니다.
로컬 또는 스테이징 환경만 `--dart-define=SUPABASE_URL=...`
`--dart-define=SUPABASE_ANON_KEY=...`로 덮어씁니다. 단기직원 API는 기본적으로
`https://timefit-omega.vercel.app`을 사용하며 스테이징에서는
`--dart-define=TABLET_API_BASE_URL=...`로 변경합니다.

구조는 `core/config`·`domain`·`infrastructure`·`application` 계층으로 분리되어 있습니다. `TabletRepository`가 관리자 연결, 출퇴근 조회·저장, 휴가 신청 RPC를 담당하고 `TabletController`가 화면 상태와 로딩을 관리합니다. 실제 화면 위젯은 이 컨트롤러를 주입해 사용하도록 확장합니다.

## 구현 단계 상태

- Phase 0 환경·계층 구조: 완료
- Phase 1 관리자 태블릿 연결 RPC: 저장소 구현 완료
- Phase 2 출퇴근 조회·저장 RPC: 저장소 구현 완료
- Phase 3 휴가 신청 RPC: 저장소 구현 완료
- Phase 4 고정 업장 출퇴근 QR 탭: 구현 완료
- Phase 5 단기직원 출근·퇴근 탭과 보안 저장 API 연결: 구현 완료
- UI 컨트롤러 연결 및 Android APK 빌드: 완료

출퇴근 QR 탭은 활성 태블릿 장치 토큰으로 해당 사업장의 고정 QR만 조회합니다. QR은 최초 한 번만 발급되며 탭 재진입이나 다시 불러오기로 변경되지 않습니다.

단기직원 탭은 출근 시 이름·주민등록번호·휴대전화 번호와 개인정보 동의를 받고,
퇴근 시 휴대전화 번호 전체만 받습니다. 주민등록번호 원문은 앱에 저장하지 않고
`TABLET_API_BASE_URL`의 서버 API에서 즉시 암호화합니다.
