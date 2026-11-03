# ADR-CHAT-001 draft: native durable chat contract v1

- Status: `APPLICATION_DIFF_DRAFT_NOT_AUTHORIZED_NOT_FROZEN`
- Ticket: [CHAT-000](https://trello.com/c/aTapyA3V)
- Review source: [timefit-ax_agent PR #19](https://github.com/sh414lim/timefit-ax_agent/pull/19) at `a8b0b882aafeaeaa749acd63f8486429a3d29b91`
- Application baseline: `sh414lim/time-fit@1119b200d9a09844e726db8daf45a25fc8142fd3`
- Proposed path: `docs/adr/ADR-CHAT-001-native-supabase-durable-realtime.md`
- Companion contract: `docs/contracts/chat-v1.md`
- Contract version: `schemaVersion: 1`

This file is a Draft PR application-diff proposal. `NOT_AUTHORIZED` means contract application, freeze and implementation remain unauthorized; publication of this Draft PR is authorized. It does not modify the user's existing `time_fit` working tree, deploy Supabase changes, approve production identity or signing, or claim a verified human review.

## 1. Context and gate state

TimeFit will add a Flutter iOS/Android client while the existing mobile web/PWA continues to operate from `time_fit`. Both clients share the canonical Supabase Auth, PostgreSQL, Storage and Realtime backend, but their UI, cache, build and release lifecycles remain independent.

The unsigned Flutter bootstrap, CI gate and application skeleton have implementation evidence. The Android and iOS release mode is the fixed decision `REUSE_DEVGYM_RECORD`; it does not permit a new listing or a fallback production ID. The exact DevGym record mapping, public application/Bundle IDs, signing lineage and actual existing-build-to-Flutter update result remain unverified REL-001/REL-003 pre-release evidence. REL-001 and REL-002 are not treated as completed by this draft. Provider configuration, actual user data access and deployment are outside this decision.

## 2. Decision

### 2.1 Repository ownership

- `time_fit` remains the source of truth for existing web/PWA code and shared schema, RLS, RPC, Storage policy, Realtime trigger and Edge Function source.
- `sh414lim/timefit-ax_agent` (the planning name `timefit-mobile`) owns Flutter UI, Drift, Outbox, RPC/Storage/Realtime adapters and native project files.
- Neither repository vendors, submodules or copies the other's source. A cross-repository feature uses versioned contracts and fixtures rather than a path or Git dependency.

### 2.2 Durable writes and canonical ordering

- Authenticated HTTPS PostgreSQL RPC is the only Phase 1 message-write path.
- A successful message RPC commits the message, attachment binding and conversation cursor in one database transaction before returning a canonical response.
- Each conversation has a server-assigned, monotonically increasing `sequence`. Client timestamps and network arrival order never define canonical ordering.
- Conversation creation is idempotent by `(owner_user_id, client_request_id)`.
- Message creation is idempotent by `(conversation_id, sender_user_id, client_message_id)`. Reuse with a different payload returns `idempotency_payload_mismatch`.
- Flutter must not directly insert, update or delete chat tables.

### 2.3 Realtime is a hint, not a write or data authority

- Private Realtime Broadcast is emitted only for committed changes.
- The envelope contains event-type-specific identifiers and occurrence time; only `message.created` carries the canonical message sequence. It never contains message body, original file name, signed URL, token or secret.
- Every valid known Broadcast triggers `timefit_chat_get_conversation` for its `conversationId` so title, archive status and conversation aggregates come from canonical state. A `message.created` event additionally calls `timefit_chat_get_messages` from the local contiguous sequence tail.
- On reconnect, app resume or ambiguous message-RPC timeout, Flutter runs conversation refresh and message gap-fill for the affected/visible conversation; periodic list refresh remains the discovery path for the conversation collection.
- Events are invalidation hints, not ordered state transitions. A per-conversation single-flight coordinator, dirty rerun and reconciliation epoch prevent delayed responses from restoring stale or purged state; message gaps are repaired from the local contiguous sequence tail. WebSocket availability never blocks durable RPC writes.
- Broadcast publication or delivery failure must not roll back an already durable message/conversation commit. The backend implementation must isolate that failure and rely on the next resume, reconnect, polling fallback or manual retry to trigger gap-fill.

### 2.4 Local-first Flutter behavior

- Drift is the UI's direct data source.
- A persistent Outbox stores commands before network execution, leases work, applies retry policy and reconciles canonical RPC responses into Drift.
- Retrying a failed send preserves the same `clientMessageId`; it must not create a second message bubble.
- Connectivity signals are hints only. RPC success or failure determines network outcome.

### 2.5 Attachments

- The flow is prepare RPC → private Storage upload → finalize RPC → send-message RPC.
- Every attachment must be `ready` before the message RPC runs.
- Binding ready attachments and inserting the message is atomic.
- An upload/finalize failure prevents message submission until the user retries or removes the failed attachment.

### 2.6 Phase 1 service boundary

- Supabase provides Auth, PostgreSQL, RPC, private Storage and Private Realtime Broadcast.
- Edge Functions are limited to push-outbox dispatch and approved Storage after-processing.
- FastAPI, EC2, Redis, a custom WebSocket gateway and WebSocket-only writes are prohibited.
- AI, AX, LLM responses, prompt tooling, RAG and fake assistant messages are out of scope.
- PWA exclusion applies only to the Flutter repository. It does not stop or replace the existing mobile web/PWA track.

## 3. Contract v1 freeze

Every successful RPC response is a JSON object with top-level `schemaVersion: 1`. Consumers ignore unknown optional fields. Missing required fields or unsupported versions are synchronization errors and trigger a supported-contract refetch rather than best-effort parsing.

### 3.1 RPC surface

| RPC | Required behavior |
| --- | --- |
| `timefit_chat_create_conversation` | Idempotent create by client request ID; conversation and owner membership in one transaction |
| `timefit_chat_list_conversations` | `(updated_at desc, id desc)` keyset pagination; safe 160-character preview |
| `timefit_chat_get_conversation` | **Proposed additive delta from architecture 146/147:** fetch one membership-authorized canonical conversation by ID, including active/archived state |
| `timefit_chat_prepare_attachment` | Validate membership, MIME, size and SHA-256; return server object path |
| `timefit_chat_finalize_attachment` | Verify the private Storage object and metadata; transition to `ready` |
| `timefit_chat_send_message` | Validate membership and schema; lock cursor; enforce idempotency; allocate sequence; atomically bind attachments |
| `timefit_chat_get_messages` | Latest, before-sequence and after-sequence queries; ascending canonical response order |
| `timefit_chat_rename_conversation` | Owner-only title update |
| `timefit_chat_archive_conversation` | Owner-only active/archive transition |
| `timefit_chat_mark_read` | Monotonic member read cursor |
| `timefit_chat_register_device` | Own installation upsert and token rotation |
| `timefit_chat_revoke_device` | Revoke the caller's app instance |
| `timefit_chat_server_capabilities` | Supported schema versions, file limits and minimum app/build policy |

The precise parameters, required/null fields, limits and response examples belong in `time_fit/docs/contracts/chat-v1.md` and versioned JSON fixtures. This ADR fixes the architecture and compatibility rules; it does not silently invent a deployed function signature.

Read-only inventory found no implemented `timefit_chat_*` object in the fresh `time_fit@1119b200d9a09844e726db8daf45a25fc8142fd3` runtime/schema. The architecture-only `timefit_chat_list_conversations` takes a status filter plus keyset cursor; it cannot guarantee a single specified conversation after an active-to-archived transition without paging a different status collection. Reusing it would make metadata recovery page-position dependent. The explicit single-row RPC above is therefore the smallest additive canonical-refresh surface. It changes the proposed RPC catalog, not an existing deployed API, and must be accepted during independent review before application.

### 3.2 Stable error taxonomy

The v1 contract uses stable machine codes, including:

- `authentication_required`
- `conversation_not_found`
- `message_empty`
- `message_body_too_long`
- `attachment_limit_exceeded`
- `attachment_not_ready`
- `attachment_already_bound`
- `attachment_object_missing`
- `attachment_metadata_mismatch`
- `idempotency_payload_mismatch`
- `unsupported_schema_version`
- `rate_limited`
- `internal_error`

Clients do not branch on human-readable PostgreSQL error text. The contract document must define the transport envelope and retry classification for each code before backend implementation is merged.

### 3.3 Realtime envelope

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "eventType": "message.created",
  "conversationId": "uuid",
  "sequence": 42,
  "messageId": "uuid",
  "occurredAt": "ISO-8601"
}
```

Phase 1 event types are `message.created`, `conversation.updated` and `conversation.archived`. The private topic is conversation-scoped and membership-authorized. Client Broadcast send/insert permission is prohibited.

The v1 field-presence rules are:

| Event type | `messageId` | `sequence` |
| --- | --- | --- |
| `message.created` | Required, non-null UUID | Required, non-null positive canonical sequence |
| `conversation.updated` | Omitted; a JSON `null` placeholder is invalid | Omitted; metadata changes do not allocate a message sequence |
| `conversation.archived` | Omitted; a JSON `null` placeholder is invalid | Omitted; archive changes do not allocate a message sequence |

All three event types require non-null `schemaVersion`, `eventId`, `eventType`, `conversationId` and `occurredAt`. These rules must be copied into `chat-v1.md` fixtures and independently re-reviewed before application; this review draft does not claim that an existing deployed producer already conforms.

For `message.created`, the client performs both canonical conversation refresh and `get_messages(afterSequence=localContiguousTail)` until the message gap is closed. The server `lastSequence`/`latestSequence` is a consistency claim, never the next cursor. For `conversation.updated` and `conversation.archived`, it performs canonical conversation refresh only. An unknown v1 event with valid common fields is not decoded into domain state; the client ignores its extension fields but schedules canonical conversation refresh as a forward-compatible safety action. Missing/null-invalid common or event-specific fields make the envelope `contract_invalid` and do not permit payload state to be applied.

## 4. Compatibility and deployment order

1. Add `chat-v1.md` and fixtures, then implement additive schema/RLS/RPC/Storage/Realtime changes in `time_fit`.
2. Run existing web regression and backend contract tests before enabling any Flutter feature flag.
3. Merge Flutter parsers and adapters against the same fixtures; keep production capability disabled until the compatible backend exists.
4. Validate development, then staging, including offline, resume, reconnect, timeout and attachment failure paths.
5. Production promotion remains blocked by REL-001/003 evidence, signing and release gates.

Compatible optional fields may be added without changing the version. An incompatible change adds a parallel `_v2` RPC or equivalent and `schemaVersion: 2`; it does not overwrite or remove v1. Existing contracts are removed only after usage is zero for every tracked consumer (at minimum current mobile web, Flutter iOS and Flutter Android), the owner of each consumer track approves removal, the documented deprecation window passes, and at least one mobile forced-update grace period has elapsed. Flutter adoption alone is never removal evidence.

Applied migrations are not edited or rolled back destructively. Backend recovery uses a forward-fix that preserves clients already consuming additive fields or RPCs. Web, Flutter and backend deployment units remain independently reversible.

## 5. Security and privacy invariants

- RLS validates active conversation membership for every read.
- Every `security definer` function declares `set search_path = ''`, schema-qualifies every referenced database object, and revalidates the caller with `auth.uid()`; a caller-supplied UUID is never trusted as identity or authorization evidence.
- Table writes occur only through approved RPCs. Direct chat-table `insert`, `update` and `delete` privileges are revoked from `authenticated`, and `anon` cannot execute chat RPCs.
- A caller without active membership receives only `conversation_not_found`, including when the supplied UUID exists; authorization responses must not disclose UUID existence.
- The attachment bucket is private; object paths are server-issued and membership-checked.
- Logs and Broadcast payloads exclude message text, file names, signed URLs, access/refresh tokens and push tokens.
- `service_role`, provider credentials, signing material and production secrets never enter the Flutter repository or contract fixtures.
- No production ID, store target, signing lineage or existing-user migration state is inferred from an app name or example value.

## 6. Session delegation and approval boundary

The user delegated planning, implementation, verification and release coordination work to named Codex sessions. That delegation assigns internal work ownership and removes repeated owner-selection questions for this draft. It does not convert a session into a person, GitHub/Trello member, CODEOWNER, legal approver or verified independent human reviewer.

Session review may establish technical draft quality and reproducible test evidence. It cannot establish platform-console access, store ownership, signing continuity, provider state, actual update success, legal/product-policy release approval or any ticket requirement that explicitly demands verified human identity or a second human approver.

## 7. Open decisions and blockers

The following are deliberately not frozen by this draft:

- the exact existing DevGym record mapping and approved Android/iOS production identity manifest, while release mode itself remains fixed as `REUSE_DEVGYM_RECORD`;
- signing, entitlement, certificate/profile and upload-owner continuity;
- REL-001 population, IAP and no-transfer execution-plan approvals;
- REL-003 supported-OS and actual existing-store-build update evidence;
- live/deployed `time_fit` catalog parity with the source inventory and the pre-application name-conflict recheck;
- request throttling values and server-capability minimum builds;
- retention, deletion, support and policy decisions for existing data;
- verified human/team approval where an external governance or release rule still requires it.

These items block production or final ADR approval as applicable. They do not authorize guessing production values or accessing live data during draft review.

### 7.1 Contract-application blockers

The companion application draft `docs/contracts/chat-v1.md` and `docs/contracts/fixtures/chat-v1/` now propose concrete answers for the following. They remain application blockers until independent QA accepts the exact application diff; no proposal here authorizes implementation start:

- success and error transport envelopes, HTTP/PostgREST status mapping and unknown-error behavior;
- retry classification for every stable error code, exactly one authentication refresh attempt, `retryAfter` units/precedence and capped exponential-backoff limits;
- idempotency fingerprint normalization, including body CRLF-to-LF handling, preserved whitespace, attachment ordering and canonical payload encoding;
- keyset pagination bounds and the behavior for sequence holes, latest-sequence disagreement, duplicate/overlapping pages and retention-visible gaps;
- attachment object-path grammar, original-file-name exclusion, overwrite prohibition, maximum five-minute download URL and the 24-hour unbound `prepared`/`ready` orphan lifecycle with bound-row race revalidation;
- event-type-specific required, omitted and non-null fields, including the `messageId`/`sequence` table in section 3.3;
- a repository inventory of current `time_fit` schema/functions/runtime names (completed in the companion draft with no proposed-name match) plus a separately authorized pre-application deployed-catalog/grant/policy recheck, with every conflict resolved additively rather than guessed.

Limits or policies not already fixed by architecture 146/147 remain explicitly undecided in `chat-v1.md` review; they must not be silently selected during application.

## 8. Draft acceptance evidence

Independent QA should verify at least:

- repository ownership and no-copy boundaries are consistent with ADR-REL-002;
- `schemaVersion: 1`, RPC names, error codes and Realtime envelope match architecture 146;
- durable RPC write, Broadcast hint, sequence gap-fill and Drift Outbox responsibilities are not conflated;
- PWA is excluded only from Flutter while existing web remains operational;
- AI/LLM, FastAPI/EC2 and production/signing changes are absent;
- open release/platform facts remain explicitly unverified;
- contract-application decisions in section 7.1 are explicit, the fixture-complete subset declared by `chat-v1.md` passes executable validation, and the remaining CHAT-001 fixture scope is not misreported as complete;
- no session is represented as a human reviewer or external authority.

The QA findings that produced this revision are not themselves a passing re-review. Draft approval records technical review only. Applying this ADR to `time_fit`, freezing CHAT-000, starting implementation, merging implementation, deploying a backend or releasing an app each require their own authorized action and evidence; an independent QA re-review of this revised review draft is required first.
