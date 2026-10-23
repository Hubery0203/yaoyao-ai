# MVP-005A: ordinary conversation quality

Status: implementation and local regression checks complete; deployment is gated on the full CI run. User approved regression checks, an independent branch and VPS deployment after validation. The hosting baseline is `e5ee2cdb77d5ab4ced62e5b39af0334347e22458`.

## Changes

- Bounded deterministic situation hints replace fixed chat/normal/general values. Questions without punctuation can be recognized by a small Chinese phrase set; explicit urgent help retains priority. No additional model invocation.
- Questions are answered before persistent hurt/anger or affectionate tone redirects the subject, except current distress/urgency or explicit relationship conflict, which retain priority.
- Directed affection is distinguished conservatively from object preferences and negated expressions. Elevated affection adds a secondary tone cue to ordinary questions or continuation instead of forcing the primary intent to affection.
- A natural response is no longer rejected merely for lacking one of six pet-name/affection words. Explicit hostile dismissal remains rejected for comfort, care and affection; the single character 滚 no longer rejects harmless descriptions of rolling movement.
- Existing recent conversation is passed into decision/response-validation inputs. These functions do not yet perform semantic history evaluation; this wiring alone is not a quality guarantee.

Identity, relationship, schema, repetition and safety gates remain. The ten-step pipeline, final-response persistence, idempotency, database role isolation and background scheduler topology remain compatible. No new migrations, ports, dependencies or resident process.

## Limits and next acceptance

These rules remain lexical heuristics. Quoted speech, indirect questions, ambiguous affection or negation can still be misclassified. Memory extraction is unchanged; 005B remains follow-up work. Reduced fixed fallback frequency is an expected effect to measure, not a result already demonstrated.

## Regression evidence

- 34 focused new assertions cover object preferences, negation, directed affection, question priority, urgency/conflict priority, natural wording, harmless rolling descriptions and retained rejection gates. Together with existing decision/validation tests: 70 pass.
- Full local unit suite: 324 pass; architecture contract: 2 pass; web checks: 2 pass. TypeScript build, ESLint and dependency boundaries pass.
- A bounded paired real DeepSeek Flash comparison used five synthetic contexts per version: object preference, daily sharing, an unpunctuated practical question, directed affection and comfort. No database writes or emotion interpretation were wired in that comparison.
- The old version forced affection for the first three inputs;005A chose continuation, continuation and answer. Both versions retained affection and comfort for the corresponding inputs.
- Observed final validation fallbacks:baseline1/5,005A0/5. Generation calls including repair:baseline7,005A5. These are single nondeterministic samples, not a benchmark or a general quality guarantee. Full synthetic responses and traces are retained in the operator's local evidence folder; no API keys are included.

Production acceptance remains required after CI:check HTTPS/login, existing history, real-model turns, persisted idempotent replay, background memory, restart recovery, resource limits and existing service baselines. Do not merge the stacked PRs as part of this deployment.
