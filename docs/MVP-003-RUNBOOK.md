# MVP-003 worker and owner operations

## Scope

This backend implements the user-authorized recovery baseline in
MVP-003-IMPLEMENTATION-BASELINE.md. The shipped extractor is deterministic,
limited to explicit Chinese/English first-person location, name, preference,
and shared-plan statements. It does not claim general semantic understanding.
Unsupported phrasing is retained in the event log without inventing a memory.
No embedding provider or paid API key is required for the memory worker.

## Start in a development environment

1. Use Node 24 and `npm ci && npm run build`.
2. Apply migrations 0001–0005 with the existing `applyMigrations` runner and
   a migration-only privileged connection. Runtime never auto-migrates.
   A database recovered from the original lost 003A migration chain must be
   reconciled separately. Do not edit already-applied migration checksums.
3. Configure API/worker DATABASE_URL with the `yaoyao_app` role, plus the API
   JWT secret and desired provider configuration. Keep credentials outside Git.
4. Register/login through the existing API; add the returned owner UUID to
   `CONTINUITY_USER_IDS` (comma-separated, at most 100 UUIDs).
5. Start API: `node apps/api/dist/main.js`.
6. Start worker: `node apps/worker/dist/main.js`. Default polling is 2s.
   With an empty owner list the worker remains idle. Restart after changing
   the allowlist. The worker does not enumerate private owners globally.
7. Send messages through POST `/api/v1/conversations/messages` using the
   existing authenticated request format. Tx2 creates the background job.
   Read GET `/api/v1/memories` after processing to inspect consolidated facts.

SIGTERM/SIGINT interrupts the polling delay, finishes the current bounded
transaction, closes the pool and exits. Abrupt process death leaves a lease
that expires; a subsequent owner pass recovers it with a new fencing token.

## Owner-only operations (Bearer JWT)

- GET `/api/v1/memories/continuity-jobs`: most recent 100 jobs; status,
  attempts, next availability and sanitized error code. No tokens/credentials.
- POST `/api/v1/memories/continuity-jobs/:jobId/requeue`: only exhausted
  `failed` jobs may be reset to pending. Returns 404 outside owner scope.
- GET `/api/v1/memories/candidates`: last 100 audited candidate decisions,
  original evidence, score inputs and optional immutable owner resolution.
- GET `/api/v1/memories/candidates/:jobId/:ordinal/evaluation`: read-only
  deterministic score comparison from recorded policy inputs.
- POST `/api/v1/memories/candidates/:jobId/:ordinal/resolve`, body
  `{"decision":"confirm"}` or `{"decision":"discard"}`: resolve a held
  candidate. Confirmation is an explicit human act, never model authority.
  Repeating the same decision is idempotent; a different later decision is
  rejected. Confirming a replacement preserves its predecessor as CORRECTED.

Diagnostics intentionally expose only a bounded recent window. Retained older
records remain addressable by their job/ordinal for review and evaluation.
Application logs contain outcome codes, not conversation text or secrets.

## Retry and recovery

Each claim leases for 60s. Completion and all memory/state effects commit in
one transaction under the live token. A failed transaction rolls back all
outputs. Retry backoff is 2^attempts seconds capped at 300s. Five failed or
expired attempts exhaust the job; the next owner pass can recover expiry,
and only explicit owner requeue resets an exhausted job. Leases are not a
promise of exactly-once execution; transactional fencing makes committed
memory effects idempotent. Future external side effects need their own outbox.

## Verification

`npm run lint`, `npm run boundaries`, `npm run build`, `npm test`.
Real database suites require Docker and the pinned PG16+pgvector image.
`tests/integration/postgres/engines.spec.ts` includes a real spawned worker
host and graceful shutdown, in addition to memory/CAS/retry/isolation tests.
`tests/integration/api/continuity.spec.ts` exercises authenticated review,
idempotency, input validation and cross-owner denial.

Deployment to a production database is not part of implementation acceptance.
