# TimeFit chat contract v1 — review application draft

- Status: `APPLICATION_DIFF_DRAFT_NOT_AUTHORIZED_NOT_FROZEN`
- Architecture baseline: [146-timefit-native-chat-architecture-2026-10-16.md](https://github.com/sh414lim/timefit-ax_agent/blob/10471939422cf27041a2366eb96aad398572e69e/docs/146-timefit-native-chat-architecture-2026-10-16.md)
- Ticket baseline: [147-timefit-native-chat-execution-ticket-catalog-2026-10-16.md](https://github.com/sh414lim/timefit-ax_agent/blob/10471939422cf27041a2366eb96aad398572e69e/docs/147-timefit-native-chat-execution-ticket-catalog-2026-10-16.md)
- Review source: [timefit-ax_agent PR #19](https://github.com/sh414lim/timefit-ax_agent/pull/19) at `a8b0b882aafeaeaa749acd63f8486429a3d29b91`
- Read-only backend inventory: `sh414lim/time-fit@1119b200d9a09844e726db8daf45a25fc8142fd3`
- Proposed path: `docs/contracts/chat-v1.md`

This is a Draft PR application-diff proposal. `NOT_AUTHORIZED` means contract application, freeze and implementation remain unauthorized; publication of this Draft PR is authorized. It neither changes the user's existing `time_fit` working tree nor asserts that any RPC, table, policy, bucket, trigger or event producer is deployed.

## 1. Inventory finding and additive delta

Read-only inspection of fresh `main@1119b200d9a09844e726db8daf45a25fc8142fd3` found no `timefit_chat_*` occurrence in runtime/schema paths (`supabase`, `server`, `src`, `pages`). The user's existing dirty `time_fit` working tree was not modified or used as the application base. Architecture 146/147 describes future chat objects, but the corresponding chat migrations and RPC implementations are absent.

| Proposed source/runtime name group | Repository inventory result |
| --- | --- |
| `timefit_chat_conversations`, `timefit_chat_conversation_members`, `timefit_chat_messages`, `timefit_chat_attachments`, `timefit_chat_device_installations`, `timefit_chat_notification_outbox` | No match in tracked HEAD or current runtime/schema paths |
| `timefit_chat_create_conversation`, `timefit_chat_list_conversations`, proposed `timefit_chat_get_conversation`, attachment/message/read/device/capabilities RPCs | No implementation match in tracked HEAD or current runtime/schema paths |
| `timefit-chat-attachments` bucket and `chat:conversation:<uuid>` topic | No implementation match in tracked HEAD or current runtime/schema paths |
| Planned `20261016000100_chat_core.sql` through `20261016000400_chat_push_outbox.sql` | Files absent; names occur only in planning documentation |

This is a source-repository inventory, not a claim about the live Supabase catalog. No database credentials or user rows were queried. Before an authorized application, Backend/CI must compare the deployed catalog, grants, policies, bucket and Realtime configuration with these proposed names; a discovered conflict requires an additive rename/new ADR rather than overwriting an object.

The planned `timefit_chat_list_conversations` accepts `p_status`, `(p_before_updated_at, p_before_id)` and `p_limit`. It returns a status-filtered, keyset-paginated collection. After an active conversation becomes archived, an active-list refresh omits it; an archived-list refresh may require arbitrary pages. It therefore cannot guarantee canonical recovery of a known conversation ID after `conversation.updated` or `conversation.archived`.

Contract v1 proposes one minimal additive delta:

```text
timefit_chat_get_conversation(
  p_conversation_id uuid,
  p_schema_version smallint default 1
) -> conversation response
```

The function validates `auth.uid()` and active membership, ignores any caller-supplied identity other than the target ID, and returns `conversation_not_found` for nonexistent and unauthorized IDs alike. Its canonical response is:

```json
{
  "schemaVersion": 1,
  "conversation": {
    "id": "uuid",
    "title": null,
    "status": "active",
    "lastSequence": 0,
    "messageCount": 0,
    "lastMessageId": null,
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "archivedAt": null
  }
}
```

`title`, `lastMessageId` and `archivedAt` are present and nullable. `archivedAt` is non-null exactly when `status=archived`. The new function is a proposal beyond the RPC list in architecture 146/147; it does not replace or change `list_conversations`.

## 2. Response and error transport

Successful PostgreSQL RPC results retain the architecture's RPC-specific JSON shape with top-level `schemaVersion: 1`; v1 does not add a generic `data` wrapper. A normalized application failure has this JSON body:

```json
{
  "schemaVersion": 1,
  "error": {
    "code": "rate_limited",
    "retryable": true,
    "retryAfterMs": 30000,
    "requestId": "uuid"
  }
}
```

Rules:

- `error.code`, `error.retryable` and `error.requestId` are required and non-null.
- `retryAfterMs` is required and a positive integer only for `rate_limited`; it is omitted, never `null`, for every other stable code. This concretizes the architecture placeholder `retryAfter` with an explicit millisecond unit.
- No response exposes raw PostgreSQL text, SQLSTATE details, stack traces, message body, file name, URL, access/refresh token or push token.
- The client branches on `error.code`, not HTTP text. HTTP classification is secondary: 401 authentication, 404 missing-or-unauthorized conversation, 409 conflict/idempotency, 422 validation, 426 unsupported version, 429 throttling and 5xx internal failure.
- A decoded server error always has a non-null UUID `requestId`. A client-originated network/timeout/malformed-response failure is a separate domain shape with `source=network|malformed_response`, `code=internal_error`, `retryable`, and no `requestId`; the client never invents one. Raw response content is not logged.

## 3. Stable errors, auth refresh and retry

| Code/source | Automatic action | Terminal or user action |
| --- | --- | --- |
| HTTP 401 / `authentication_required` | Refresh auth exactly once, then replay the identical request and idempotency key | Enter login only if refresh fails or the replay is again 401/`authentication_required`; any other replay result uses its normal taxonomy |
| `conversation_not_found` | No retry | Unsubscribe and purge that conversation's sensitive local cache |
| `message_empty`, `message_body_too_long`, `attachment_limit_exceeded`, `attachment_metadata_mismatch`, `attachment_object_missing`, `idempotency_payload_mismatch`, `unsupported_schema_version` | No automatic retry | Show safe domain action; never expose raw backend text |
| `attachment_not_ready` | Resume prepare/upload/finalize state; do not blind-retry send | Send only after every attachment is canonical `ready` |
| `attachment_already_bound` | Refresh canonical state once | Prepare a new attachment ID only if the user sends a new logical message |
| `rate_limited` | Retry no earlier than `retryAfterMs`; do not add a shorter local delay | Stop after the common eight-consecutive-failure limit |
| `internal_error`, network error, timeout, HTTP 5xx | Retry only idempotent calls/commands | Stop after the common eight-consecutive-failure limit |
| Unknown stable code | No automatic retry | Map to safe internal failure and record code name only |

For ordinary retryable failures the delays are 1, 2, 4, 8, 16 and then 30 seconds, with ±20% jitter and a 30-second local-backoff ceiling. Automatic retry stops after eight consecutive failures and waits for explicit user retry. A successful canonical response resets the counter. `rate_limited.retryAfterMs` is an authoritative minimum delay rather than local backoff and is not shortened to the 30-second ceiling. Connectivity merely wakes commands whose `nextAttemptAt` has elapsed.

The single auth refresh is per logical operation, not per network attempt. The replay retains `clientRequestId` or `clientMessageId`; it never creates a new logical command. A replay timeout, 429, 5xx or stable non-authentication error must not be mislabeled as authentication failure or force login.

## 4. Message idempotency normalization

The uniqueness key remains `(conversation_id, auth.uid(), client_message_id)`. The server computes a payload fingerprint only after authorization and input validation from this canonical tuple:

```json
{
  "schemaVersion": 1,
  "conversationId": "lowercase-uuid",
  "senderUserId": "auth.uid()-lowercase-uuid",
  "bodyText": null,
  "attachmentIds": ["lowercase-uuid-in-user-order"]
}
```

- UUIDs use their lowercase hyphenated textual form. `senderUserId` comes only from `auth.uid()`.
- Convert CRLF to LF. If `btrim(normalizedBody)` is empty, canonical `bodyText` is `null`; otherwise preserve normalized leading/trailing whitespace, indentation and newlines. A lone CR is preserved because architecture 146 specifies only CRLF normalization.
- Preserve attachment array order because it is presentation order; duplicate IDs are invalid. Do not sort the array.
- Serialize UTF-8 JSON with the exact field order shown, no insignificant whitespace, and hash its bytes with SHA-256.
- `clientCreatedAt` is auxiliary metadata and is excluded from the fingerprint. It cannot affect authorization, ordering or idempotent equivalence.
- A matching key and fingerprint returns the existing canonical message. A matching key with a different fingerprint returns `idempotency_payload_mismatch` and never mutates the existing row.

## 5. Pagination and sequence holes

Conversation lists use `(updatedAt desc, id desc)`. Both cursor members are present together or both omitted. Limit is 1–50. The response carries `nextCursor` as either an object with both values or JSON `null`; the cursor comes from the final returned row. Status is explicit and the collection endpoint is not used for a known-ID event refresh.

Message history accepts exactly one of `beforeSequence` or `afterSequence`, or neither. Limit is 1–100; neither means the latest 50. All returned arrays are in ascending sequence order. `afterSequence=N` returns values greater than `N` up to limit and includes `latestSequence` plus `hasMoreAfter`. Every follow-up request recomputes `N` from the greatest locally stored contiguous canonical sequence, never from `latestSequence` or the largest non-contiguous response value. `latestSequence` is used only to detect disagreement.

V1 does not permit a silent canonical sequence hole: message rows or explicit tombstones occupy every allocated sequence. On a detected hole the client does not advance past it. It repeats one gap-fill from the greatest contiguous predecessor. If the same response still claims `latestSequence` at or beyond the missing value while omitting the value, the client marks the conversation stale with `contract_invalid`, retains existing canonical rows and schedules a full conversation refresh; it never fabricates or renumbers a message.

Retention, deletion and tombstone lifetime are not decided here. Any later policy that makes a server sequence intentionally unavailable must first define a versioned tombstone/gap contract and receive separate product/privacy/retention approval.

## 6. Attachment contract

- Prepare validates active membership, MIME allowlist, 1–20 MiB and lowercase 64-hex SHA-256. It creates a `prepared` row with `expiresAt=serverNow+24h`.
- The server-generated object path is exactly `<auth.uid()>/<conversationId>/<attachmentId>` using lowercase UUIDs. Original file names never appear in paths.
- The bucket is private. Upload requires a matching prepared row. Object overwrite/upsert is forbidden; if the path exists, the client must request a new attachment ID rather than replace bytes.
- Finalize checks the exact bucket/path and server-observed content type and size. A missing object returns `attachment_object_missing`; mismatch returns `attachment_metadata_mismatch`. Neither state may be bound.
- An authenticated download or signed URL may live for at most five minutes. URL/token values are never persisted in Drift, fixtures, events or logs.
- Send runs only after every attachment is `ready`; message insert and attachment binding commit atomically.
- At/after `expiresAt`, an hourly service-role worker may claim only unbound `prepared`/`ready` rows. Immediately before Storage deletion it rechecks that the row is still unbound and expired. It deletes the object, then marks the row `orphaned`; an already-missing object is idempotent success. A bound row is never deleted by this worker.

## 7. Realtime envelope and reconciliation

Common required non-null fields are `schemaVersion`, `eventId`, `eventType`, `conversationId` and `occurredAt`. Event payloads never carry canonical title, archive state, message body or attachment data.

| Event | `messageId` | `sequence` | Canonical recovery |
| --- | --- | --- | --- |
| `message.created` | Required non-null UUID | Required integer ≥1 | `get_conversation`, then message gap-fill repeatedly from the recomputed local contiguous tail |
| `conversation.updated` | Omitted, not `null` | Omitted, not `null` | `get_conversation` |
| `conversation.archived` | Omitted, not `null` | Omitted, not `null` | `get_conversation` |
| Unknown v1 event | Ignored extension | Ignored extension | Ignore event-specific payload and schedule `get_conversation` using valid common fields |

### 7.1 Per-conversation coordinator

Canonical reads alone do not make delayed responses or out-of-order events safe. Each conversation has one reconciliation coordinator with these fields: `epoch`, `inFlight`, `dirty`, `subscribed`, and `outboxRunning`.

1. When a valid event arrives and no refresh is running, capture the current `epoch` and start exactly one canonical refresh.
2. When another event arrives while that refresh is running, set `dirty=true`; do not start a parallel refresh.
3. On response, first compare its captured epoch with the current epoch. Discard a mismatch without writing Drift.
4. A matching response applies canonical conversation fields in one Drift transaction. If `dirty=true`, clear dirty and immediately run one more refresh; otherwise finish. Event arrival order is never applied as conversation state.
5. `message.created` also runs message gap-fill. Each request uses the local contiguous tail at dispatch time; after each upsert it recomputes that tail before deciding the next request.

For `conversation_not_found` or confirmed membership loss, the coordinator acquires the conversation mutex and performs one local revocation boundary: increment/persist `epoch`, set membership state removed, set `outboxRunning=false`, cancel/release that conversation's queued and leased Outbox work, delete its sensitive Drift rows/private attachment copies, clear `dirty/inFlight`, and detach the subscription before releasing the mutex. A callback already queued by the transport carries its captured old epoch and is discarded. Network unsubscribe itself is not a database transaction; epoch validation is the atomic local barrier that prevents a late callback or successful RPC response from recreating purged state.

The canonical refresh response overwrites local `title`, `status`, `archivedAt`, `lastSequence`, `messageCount`, `lastMessageId` and server timestamps in one Drift transaction only after the epoch check. Duplicate or out-of-order events merely mark the coordinator dirty; safety comes from serialization, rerun and epoch validation, not from assuming read responses arrive in order.

An envelope missing a required field, containing `null` for a required field, containing `messageId`/`sequence` as `null` where those fields must be omitted, or missing the message fields for `message.created` is `contract_invalid`. The client applies no payload state. Broadcast publication/delivery failure never rolls back durable database commit; resume, reconnect, periodic collection refresh and manual retry provide recovery.

## 8. Contract boundaries and unresolved policy

- Every `security definer` function uses `set search_path = ''`, schema-qualifies all objects and revalidates `auth.uid()`.
- Direct chat-table DML is revoked from `authenticated`; `anon` has no chat RPC execute permission.
- Unknown optional JSON fields are ignored. Missing required fields and unsupported `schemaVersion` fail closed.
- Existing web/PWA contracts remain additive and independently deployable. V1 removal requires zero usage for every tracked consumer, each track owner’s approval, the deprecation window and at least one mobile forced-update grace period.

This contract does not decide retention/deletion duration for bound messages or files, legal hold, account deletion semantics, customer-support access, product moderation, or notification policy. Those require separate product/privacy/retention decisions and cannot be inferred from the 24-hour unbound-upload cleanup rule.

## 9. Fixture expectations

`docs/contracts/fixtures/chat-v1/manifest.json` is the executable expectation index. The validator and wrapper in that directory decode and route the events, check manifest actions against actual router output, reject invalid UUID/date-time/version/sequence and required/forbidden-field cases, and execute reconciliation/auth scenarios. Valid known events trigger the recovery table above. Invalid missing/null fixtures fail with `contract_invalid` without state application. The unknown v1 event is forward-compatible: ignore its extension payload, refresh only the canonical conversation, and do not treat its new type as a message.

Current fixture-complete scope is deliberately narrow: Realtime envelope decoding/routing, reconciliation epoch/single-flight behavior, local-contiguous-tail cursor selection, server-vs-client failure identity, and the one-refresh authentication decision table. The idempotency normalization, full pagination-hole RPC response matrix and attachment rules in sections 4–6 are reviewed design inputs, but their full RPC schemas, success/error examples, boundary/property matrices and cross-repository checksum copies remain CHAT-001 work after CHAT-000 is independently frozen. This draft does not claim CHAT-001 fixture completion or authorize implementation.
