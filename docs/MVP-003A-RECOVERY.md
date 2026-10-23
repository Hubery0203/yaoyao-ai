# MVP-003A reconstruction (2026-10-23)

Base: MVP-002G `0a51a87e982c2fbd3df436f7e9f7009cacbb325c`.
The original local-only `3d7ff33` and migrations 0004–0006 are unavailable.
This is a new implementation of the recoverable durability requirements,
not a byte-for-byte restoration or an inheritance of prior acceptance.

## Implemented contract

- Tx1 stores the user message; Tx2 atomically stores the final assistant
  message and one Postgres continuity job. Failure of enqueue rolls back Tx2.
- Owner + YaoYao + requestId identify a turn; transaction-scoped advisory
  locking serializes duplicate message writes. The first committed assistant
  event wins, and retries reuse its event/job without resetting job state.
- A job requires matching persisted USER_MESSAGE and ASSISTANT_MESSAGE events.
- Workers claim per authenticated owner through the transaction manager,
  using FOR UPDATE SKIP LOCKED. No global owner enumeration is introduced.
- Claim increments attempts and creates a fresh lease token. Completion
  requires the current unexpired token. Expired leases return to pending;
  stale workers cannot complete a reclaimed job.
- PostgreSQL owns queue state. No Redis queue, LLM worker, memory extraction,
  proactive messages, or automatic scheduling are part of this reconstruction.

## New implementation choices

Migration `0004_continuity_jobs` extends the surviving 0001–0003 chain.
It MUST NOT be applied to a recovered original 003A database with its own
0004–0006 history; reconcile the histories first. No old migrations changed.
Lease duration is caller supplied, bounded to integer 1–3600 seconds. There
is no heartbeat, automatic retries cap, retry backoff, or dead-letter policy;
those require the worker design. Job execution is at least once. Future
worker effects must be idempotent and fenced in their own write transaction;
checking a completion token alone cannot undo already-applied side effects.

Existing completed turns are not backfilled automatically. A duplicate Tx2
call can ensure a job for an existing paired turn; the orchestrator's fast
completed-response path itself remains read-only.

## Verification

Local TypeScript build, ESLint, and architecture checks passed during
reconstruction. Full local suite: 297 passed, 75 skipped, with three health
endpoint tests initially blocked by sandbox listen EPERM. Those three passed
when rerun with local socket permission (300 passed across the two runs).
Three new real-Postgres
integration cases cover rollback/retry atomicity, concurrent claim, restart,
owner isolation, expired/stale leases, and rejection of orphan messages.
They are skipped locally because Docker is absent; database acceptance
requires the GitHub Actions integration job (or a Docker-equipped machine).
