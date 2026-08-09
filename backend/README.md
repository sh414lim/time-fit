# TimeFit API

PostgreSQL + Prisma 기반의 TimeFit 백엔드 골격입니다.

## 시작하기

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

PostgreSQL이 준비되어 있어야 합니다. 스키마만 검증하려면 `npm run db:validate`를 실행합니다.

## 1차 API

| Method | Path | 설명 |
|---|---|---|
| GET | `/health` | 상태 확인 |
| GET | `/api/v1/employees?organizationId=` | 재직 직원 조회 |
| POST | `/api/v1/employees` | 직원 및 현재 근로계약 생성 |
| POST | `/api/v1/attendances/check-in` | 출근 기록 생성/갱신 |
| POST | `/api/v1/attendances/:id/check-out` | 퇴근 및 근무분 계산 |
| POST | `/api/v1/leave-requests` | 휴가 신청 |
| POST | `/api/v1/leave-requests/:id/approve` | 휴가 승인 및 사용량 반영 |

인증 미들웨어와 조직 권한 검증은 다음 구현 단계에서 각 라우트 앞에 추가합니다. 현재 API 입력에는 조직 ID를 명시해 도메인 데이터 범위를 보존합니다.
