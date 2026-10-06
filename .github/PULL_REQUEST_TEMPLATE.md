## Scope checklist (MVP-001)

- [ ] This PR does not add LLM calls, prompts, or model-produced state writes.
- [ ] This PR does not add MVP-002+ behavior (persona, conversation, memory ranking, emotion algorithm, reflection, proactive, image, voice).
- [ ] Business rules live in `@yaoyao/domain` (aggregates / value objects / policies) — not in controllers, DTOs, migrations, or prompts.
- [ ] No new client-mutable path to identity, relationship type/status/termination, or raw state.
- [ ] `npm run boundaries` passes (dependency-cruiser).
- [ ] New persistent state change appends its event in the same transaction (or documents why not).
- [ ] Tests assert domain postconditions, not just HTTP 200.

## What changed

## Test evidence
