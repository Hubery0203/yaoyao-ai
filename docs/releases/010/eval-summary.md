# 010 A/B local evaluation

Status: ready for scoped live evaluation; not deployed, GitHub CI pending.

- 735 unit + 2 architecture contracts passed.
- 236 integration + 3 e2e passed against real local PostgreSQL16/pgvector, real migrations and least-privilege roles. A local serial Testcontainers replacement selects the disposable loopback test DB; Docker/Linux execution remains for CI.
- 21 Node tests passed (private web, Weixin probe and encrypted backup).
- Build, ESLint and dependency boundaries passed; no package/dependency changes.
- 010 fixtures: 12 synthetic cases, 14 mock invocations, no rule failures, including forced burst-echo and revoked-suggestion repairs.
- 009 fixtures: 12 cases/15 mock invocations; 008: 10/11; quality: 12 cases; all rule/replay checks passed.
- Real provider calls: 0. Human tone verdict: pending. No user Weixin history used for evaluation.
- No VPS write, proxy change, external message, offsite setup or image API request.

Single local suite success is not a measured pass^3 reliability result or proof of naturalness. Unit/rule checks cannot establish open-ended quality. Manual security review checked source ownership, scoped RLS, atomic action/reply commits, confirmation/CAS, clock handling and cancellation boundaries; CI and live acceptance still gate publishing.

Live candidate review: first12 cases/15 provider attempts rejected pending corrections (extra followups/advice and a too-literal lexical check). Three regression tests added; all738 unit +2 contracts passed. Original PG/e2e/Node results above precede these runtime-only review corrections; CI will rerun the full matrix. Remaining9 attempts may repair only the original scenarios. The binary-search grader now accepts middle-point synonyms and still requires manual factual review.

The remaining9 attempts were used. Total24 requests: candidate NOT released. The final completed-share case had no provider attempt left; the refusal case fell back because a declarative free-choice phrase was misclassified. Final repair differentiates declarative choice from a question, aligns deterministic follow-up guidance with casual/resolved/refusal pacing, and keeps concise colloquial comfort while rejecting extra rest assignments or unrelated technical-answer preambles. All744 unit +2 architecture contracts passed; final CI reruns the full matrix. Additional live attempts require a new scoped owner budget; none were made.
