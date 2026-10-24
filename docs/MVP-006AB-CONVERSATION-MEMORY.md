# MVP-006A + 006B: receipt-time grounding and owner memory management

## State

Implemented locally on `codex/mvp-006-ab`. TypeScript build, JavaScript syntax, ESLint and dependency-boundary checks are the current validation scope. User has approved regression, GitHub upload/CI and deployment after validation. Local tests pass; CI-backed real PostgreSQL integration and cloud acceptance are still required. No production update or Weixin authorization has yet been performed.

## 006A

- C6 retains role/text and adds each persisted message's server receipt time in UTC. The runtime supplies one current server-time anchor.
- Receipt time does not establish the date of the event a user describes. Guidance omits unsupported elapsed time and does not infer the user's timezone.
- A narrow validation guard catches certain Chinese recall replies that describe a literal, freshly stated fact as days/weeks old. It uses recent user messages, not assistant claims. If the same literal fact already has older user evidence, the guard permits it. This is not general temporal reasoning or contradiction detection.
- A rejected elapsed-time claim gets the existing single repair attempt. Sanitized quality telemetry records `elapsed_recall_time`; no additional model call is added to successful turns.
- Guidance supports short answers, explicit topic changes, fewer automatic follow-up questions and preserving negation for the same object without erasing unrelated preferences.

## 006B

- Current, pending, corrected historical versions and resolved candidates have separate views. Memory details show the original source text and the predecessor chain.
- Page sizes are bounded: memory lists 50 in the UI / 200 maximum; review lists 50 / 100 maximum. PostgreSQL filters before LIMIT/OFFSET and counts pending candidates independently of the loaded page. Existing legacy audit endpoints remain available.
- Details read at most 10 source events and 20 predecessors, report truncation and allow opening older versions to continue the chain.
- `GET /api/v1/memories/review?status=pending|resolved&limit=50&offset=0` exposes projected candidate content, reason, evidence and resolution; no raw scoring inputs are included.
- `GET /api/v1/memories/:memoryId/detail` provides projected memory, predecessors, source quotations and whether direct correction is available.
- `POST /api/v1/memories/:memoryId/correct` requires JWT, an Idempotency-Key and `{text, expectedVersion}`. Only a single explicit fact in the current SEMANTIC memory's same canonical slot can be corrected directly. Locations/names can change; preferences can change polarity for the same object. Unknown grammar, multiple statements, uncertainty, different objects and CORE edits are rejected. The UI explains the boundary.
- Correction locks the owner/entity, rechecks the current version/status, appends one immutable USER/MEMORY_CORRECTED event containing the owner's statement, supersedes the old memory, inserts the replacement and updates the slot source sequence in one transaction. The corrected source is the new owner event, not an invented chat message.
- The source sequence fences delayed older background candidates. Exact request replay returns the existing result; reusing a key with different content is a conflict. CORE updates continue through candidate confirmation.
- Logout invalidates in-flight list/detail responses and closes/clears the detail view. DOM text is inserted with textContent, not user-controlled HTML.

## Required release acceptance

1. Short answer after a question, explicit subject change, and acknowledgment without repetitive follow-up.
2. Fresh negative correction followed by recall: no unsupported elapsed-time claim; older user evidence must not be falsely rejected.
3. Unrelated drink preferences survive a negation for a different drink.
4. Real PostgreSQL: correct same-slot location/preference; old version and exact source survive reload/restart.
5. Idempotent replay, changed-body key reuse, stale version, two concurrent corrections and delayed background processing.
6. Foreign owner detail/correction/review access, CORE edit, uncertain/multiple/different-slot statement rejection.
7. Pending/processed pagination beyond 100 old audits, exact pending count, empty states and logout during requests.
8. Browser review on narrow/mobile width, keyboard operation, retry/error states and retained form content.
9. Backup, exact release verification, API restart, resource/cgroup checks and same-host service baseline.

## Deployment

No migration, dependency, container, public port or resource-limit change. This version adds authenticated application routes and database queries. Build outside the VPS, take a cloud backup, switch the release and restart only YAOYAO API after explicit deployment approval. The 512 MB host has previously reached the soft memory threshold; list pagination limits application memory growth but does not establish capacity.

Rollback to 005BC keeps the cloud database. Its memory retrieval can read consolidated owner-corrected memories because event types and schema are unchanged. The old UI will not show the new source-detail/correction actions. Do not restore an old DB snapshot over newer cloud writes. No Weixin bridge is part of this deployment.
