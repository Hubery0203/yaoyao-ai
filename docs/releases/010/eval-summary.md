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
