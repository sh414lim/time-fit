# TimeFit

직원 출퇴근, 스케줄, 휴가·연차, 급여 관리를 위한 1차 관리자 웹 애플리케이션 골격입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 터미널에 표시되는 로컬 주소를 엽니다.

## 구성

- `docs/01-product-plan.md`: 서비스 1차 기획서
- `src/main.jsx`: 대시보드와 화면 전환을 포함한 UI 시작점
- `src/styles.css`: 반응형 관리자 UI 스타일

현재 프론트엔드는 브라우저 상태 기반의 MVP이며, API와 PostgreSQL 스키마는 `backend/`에 분리했습니다.

## 백엔드·데이터베이스

기능 목록과 1차 데이터 모델 검증은 [02-feature-validation.md](docs/02-feature-validation.md)에서 확인할 수 있습니다. Prisma/PostgreSQL 스키마와 Express API 골격은 [backend/README.md](backend/README.md)에 안내되어 있습니다.

관리자·직원 관점의 상세 업무 흐름과 향후 역할 권한 분리 계획은 [03-user-scenarios.md](docs/03-user-scenarios.md)에서 확인할 수 있습니다.

배포 화면에서 수행한 역할별 브라우저 테스트와 개선 우선순위는 [04-scenario-test-feedback.md](docs/04-scenario-test-feedback.md)에 정리되어 있습니다.
