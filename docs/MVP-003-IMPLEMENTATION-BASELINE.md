# MVP-003 implementation baseline · recovery v1

Authority: on 2026-10-23 Hubery authorized completing missing designs,
redefining an executable scope and implementing all MVP-003. This document
supersedes incomplete Muse technical proposals for implementation choices;
it preserves the existing product identity, permanent relationship, separation
of Event/State/Memory, owner isolation and LLM-proposal-only authority.
It does not claim recovery of the lost original specification.

## Complete milestone scope and acceptance

A. Durable jobs: the reconstructed Tx2 queue, atomic claim, fenced completion,
expiry recovery. Extend with bounded retry/backoff and observable failure.
B. Memory Engine 2.0: background, grounded candidate extraction; versioned
five-signal scoring; exact deduplication; slot-aware correction with immutable
old-memory history; CORE/ambiguous interpretations held for review; audited
candidate decisions; ordinary consolidated memories usable by existing C4.
C. Emotion Engine 2.0: deterministic elapsed-time evolution toward baseline,
different decay rates, persistent multi-emotion state with CAS and event
traceability; applied before a new turn, never during read-only context or
historical replay. Urgent-user support remains the existing decision priority.
D. Continuity and internal reflection: real owner-scoped Postgres worker,
bounded polling, graceful shutdown, failed-job diagnostics/requeue, restart
recovery, bounded internal reflection referencing grounded memories. No
invented biography or external facts; no proactive messages or timers that
manufacture feelings while offline.
E. Acceptance: pure-policy and PostgreSQL integration tests for scoring,
source validation, correction/dedup, held candidates, stale workers, atomic
rollback, crash/retry, emotion evolution and retrieval; full preexisting CI.

The milestone is a backend deliverable. Voice, images, proactive outreach,
external push, frontend UX and a semantic embedding service are outside it.
No production rollout is authorized by completing the code.

## Memory policy v1 (new, explicit choices)

Only exact evidence quoted from the completed turn's USER_MESSAGE can
become a factual user memory. The built-in extractor recognizes a small
allowlist of explicit self-reported facts/preferences/plans in Chinese and
English. Unsupported language/ambiguous text yields no durable fact; it does
not guess. An optional proposal extractor may supply additional candidates,
but the same Core evidence and schema validation still applies.

Candidate fields: content/evidence, type, slot, value, confidence,
importance and relationship relevance, all numeric signals in [0,1].
Five-signal score = .30 importance + .25 relationship relevance + .20
confidence + .15 lexical novelty + .10 recurrence. Threshold >= .55.
Lexical novelty is normalized character-bigram Jaccard distance to existing
consolidated memories, with stable policy ID `memory-v1-lexical`. Recurrence
is min(1, number of prior distinct source events supporting the exact slot
and value / 3). Stored score input snapshots enable pure deterministic
re-evaluation; historical replay never calls extraction or writes anything.
Retrieval-time signals remain independent of consolidation scoring.

Facts require confidence >= .8 and exact grounded text. CORE candidates
are held awaiting explicit owner confirmation; interpretation candidates
are held as interpretation and never silently promoted to facts. Slot
correction requires the new user statement to explicitly signal a change;
otherwise conflicting values are held, preserving the prior effective fact.
Conflicting plans/commitments are held for confirmation, never canceled
implicitly. Duplicate evidence does not create another memory. Historical
versions, candidate outcomes and source events remain queryable.

## Operational choices

Workers use an explicit CONTINUITY_USER_IDS owner allowlist, RLS runtime
credentials and no privileged global-owner scan. Owner/job input comes from
trusted server configuration. Poll default 2s, one job/owner/pass, 60s lease,
5 failures maximum, exponential backoff capped at 5 minutes. Final commit
locks and checks the lease, applies memory/state/audit and completes in the
same transaction. Worker effects are fully fenced; failures roll back.
Exhausted jobs are visible and can be explicitly requeued by the owner.
Original 003A databases with conflicting 0004–0006 must be reconciled before
migration; the supported migration chain begins at surviving 0001–0003.
