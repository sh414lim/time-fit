# Timefit AX receipt service

This service implements the authenticated Timefit receipt contract used by the web app:

- `GET /health` (`/healthz` remains available locally, but Cloud Run reserves some paths ending in `z`)
- `POST /api/timefit/v1/receipt-sessions`
- `X-Timefit-Ax-Key` shared-secret authentication
- public HTTPS image download with DNS/private-network, redirect, content-type, size and timeout checks
- Google Cloud Vision document OCR using the Cloud Run service account
- Firestore-backed `requestId` idempotency and conflict protection across Cloud Run instances

The production secret is stored in Google Secret Manager and injected into Cloud Run. Do not put it in this repository.

Production sets `TIMEFIT_AX_IDEMPOTENCY_BACKEND=firestore`. Local development and unit tests default to the in-memory backend.
