# TimeFit Native Tablet

Flutter 기반 태블릿 전용 클라이언트의 1차 포팅 구조입니다.

## 실행

```bash
flutter pub get
flutter run --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co --dart-define=SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

구조는 `core/config`·`domain`·`infrastructure`·`application` 계층으로 분리되어 있습니다. `TabletRepository`가 관리자 연결, 출퇴근 조회·저장, 휴가 신청 RPC를 담당하고 `TabletController`가 화면 상태와 로딩을 관리합니다. 실제 화면 위젯은 이 컨트롤러를 주입해 사용하도록 확장합니다.

## 구현 단계 상태

- Phase 0 환경·계층 구조: 완료
- Phase 1 관리자 태블릿 연결 RPC: 저장소 구현 완료
- Phase 2 출퇴근 조회·저장 RPC: 저장소 구현 완료
- Phase 3 휴가 신청 RPC: 저장소 구현 완료
- UI 컨트롤러 연결 및 Android/iPad 실기기 빌드: 다음 작업
