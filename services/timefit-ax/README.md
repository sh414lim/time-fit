# Timefit AX receipt service

This service implements the authenticated Timefit receipt contract used by the web app:

- `GET /health` (`/healthz` remains available locally, but Cloud Run reserves some paths ending in `z`)
- `POST /api/timefit/v1/receipt-sessions`
- `X-Timefit-Ax-Key` shared-secret authentication
- public HTTPS image download with DNS/private-network, redirect, content-type, size and timeout checks
- original image analysis by an image-capable LLM with a strict JSON schema (no OCR/rule fallback)
- Firestore-backed `requestId` idempotency and conflict protection across Cloud Run instances

The production secret is stored in Google Secret Manager and injected into Cloud Run. Do not put it in this repository.

Production sets `TIMEFIT_AX_IDEMPOTENCY_BACKEND=firestore`. Local development and unit tests default to the in-memory backend.

## LLM configuration and rollout

The default `TIMEFIT_AX_LLM_BACKEND=openai` requires `LLM_API_KEY` and an explicit image-capable `LLM_MODEL`. Inject secrets through the deployment secret store. Images are sent to the Responses API with `store: false` and the schema in `receipt-schema.json`; malformed, refused, incomplete, or failed responses fail the request rather than returning rule-parsed values.

Alternatively, `TIMEFIT_AX_LLM_BACKEND=codex` uses an authenticated Codex CLI installation (`CODEX_CLI_BIN`, optional `TIMEFIT_AX_CODEX_MODEL`). The provided Node Docker image does **not** bundle the CLI or its authentication: provision those separately if choosing this backend. Each invocation uses an isolated temporary directory, image attachments, a read-only sandbox, and the same output schema. Temporary files are removed afterward.

Deploy the updated AX service first, test an authenticated request with a fresh request ID, and verify `provider` is `openai_image` or `codex_image` and `model` is present. `/health` checks HTTP liveness only, not model credentials. Then deploy the web changes with the same `TIMEFIT_AX_TRANSPORT_KEY` and correct HTTPS `TIMEFIT_AX_URL`/`TIMEFIT_AX_ALLOWED_HOSTS`. Older services without the explicit LLM contract are deliberately rejected. Do not reuse an old cached request ID when verifying the rollout.

The web application keeps unknown numeric values null, requires incomplete or arithmetically inconsistent invoice lines to be reviewed, and displays only the latest extraction's line items. Historical extractions are retained. Previously incorrect records are not automatically rewritten; reprocess them after deployment and verify their new extraction before approving expenses.

Regression case: the supplied six-item transaction statement must total 60,150 KRW, not its previous balance of 7,401,385 KRW. Quantities are 2, 4, 2, 0.5, 0.5, 2; line amounts are 3,600, 42,000, 4,400, 4,900, 2,250, 3,000. The original stored image was successfully analyzed through the new Codex image backend locally. This is not proof of production deployment or production database write verification.
