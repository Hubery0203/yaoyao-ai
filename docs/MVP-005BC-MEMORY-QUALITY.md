# MVP-005B / 005C: versioned memory and multi-turn quality

## Delivered scope

### 005B: explicit memory v2

- Natural explicit preference forms, including recent/strong preferences, negative preferences and specified eating/drinking restrictions.
- Explicit corrections of location/name and same-slot preference polarity. Temporary moods/desires/today-only statements produce no durable candidate.
- Supported speculative facts/preferences become low-confidence interpretations held for owner confirmation. Unsupported ambiguous text produces no invented fact; conversational guidance asks for clarification when needed.
- Original source quotes and event provenance are retained. Different objects do not automatically replace one another: categories, synonyms and implicit cross-object replacements are not inferred.
- `memory-v2-explicit` is a new policy identifier. The v1 parser is frozen separately for historical candidate confirmation; historical scores can be replayed for v1 and v2 using recorded inputs. No previous audits, events or migration checksums are rewritten.

### 005C: multi-turn behavior and observable regression

- Current request is excluded from the owner-scoped SQL history window before LIMIT, so it is not both prior C6 history and current C7 input.
- Bounded guidance uses existing role-labelled history: short replies continue the established subject, avoid answered questions and unsupported memories, and distinguish corrections/uncertainty. It adds no model call.
- Validation catches verbatim previous assistant responses and limited exactly repeated answered questions; explicit requests to repeat remain allowed. This is a lexical guard, not semantic paraphrase detection.
- Rejected attempts retain sanitized stage/reason codes even if repair later succeeds. Provider fallback and validation fallback are separate fields, including provider fallback during repair.
- API emits allowlisted `conversation_quality` JSON records through the existing logger. Records identify generation attempts versus replay and contain no user text, response, user ID, key or raw rejection reason. Logging failure cannot turn a committed reply into a failed send. This is operator telemetry in existing logs, not a new public endpoint or an exact unique-message counter.
- A reproducible four-session,12-turn evaluator runs in mock mode in CI and uploads its JSON artifact. The deterministic case includes one forced repetition that must be rejected and repaired. Real mode requires a private environment key and uses synthetic contexts only.

## Run

Build with Node24, then:

```
node scripts/evaluate-quality.mjs --mode mock --out quality-report.json
```

For a bounded real-model run, provide `DEEPSEEK_API_KEY` and optionally `DEEPSEEK_MODEL` through a private environment, then use `--mode deepseek`. Never commit secrets or upload environment files. No local database/server or production account is required for this evaluator. Persistence, fencing, owner isolation and review compatibility are covered separately by real PostgreSQL integration tests.

## Validation coverage

New tests cover natural preference forms, corrections, polarity, temporary states, uncertainty, source/slot tampering, historical v1 confirmation/scoring, owner-only confirmation, idempotent review, real SQL history exclusion, repeated/answered questions and privacy/failure isolation for telemetry. Existing lease, out-of-order, rollback, core-memory confirmation and append-only coverage remains in the suite.

The operator's bounded real-model sample completed12 turns without provider/validation fallback, replay failure or lexical-hint failure. This is a single nondeterministic sample; lexical hints are not semantic scores. Synthetic evaluations do not prove long-term retention or production capacity. Full CI and production acceptance are separate gates.

## Deployment and rollback

No new database migration, dependency, endpoint, daemon, port or resource-limit change. Changes affect application/domain policy, owner-scoped read queries and one small completed-attempt log record. Existing512MB single-concurrency runtime remains the target, subject to deployment approval.

Back up the cloud DB before a future approved rollout. A code rollback to005A retains the cloud database and consolidated memories. The old code cannot review/replay v2 audits; those operations must wait for v2-capable code. Do not reinterpret v2 evidence under v1 and do not restore an old local snapshot over cloud writes.

Production VPS update requires its own assessed approval under the user's standing rule. This document does not claim deployment.
