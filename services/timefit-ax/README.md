# Timefit AX receipt service

This service implements the authenticated Timefit receipt contract used by the web app:

- `GET /healthz`
- `POST /api/timefit/v1/receipt-sessions`
- `X-Timefit-Ax-Key` shared-secret authentication
- public HTTPS image download with DNS/private-network, redirect, content-type, size and timeout checks
- Google Cloud Vision document OCR using the Cloud Run service account
- in-instance `requestId` idempotency and conflict protection

The production secret is stored in Google Secret Manager and injected into Cloud Run. Do not put it in this repository.
