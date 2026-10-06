# YaoYao AI · MVP-001 Core Foundation

Persistent digital companion core — 沈知遥 / 遥遥.

MVP-001 establishes YaoYao as a **persistent system entity**: durable identity,
permanent relationship, versioned state, append-only event history, memory
foundation, session lifecycle, authorization boundaries, and read-only replay.
It deliberately contains **no LLM calls and no companion behavior** — those are
later milestones built on this foundation.

Engineering priority: Identity > Relationship > State > Memory > Event > Runtime > LLM > UI.

## Governing contracts (frozen — do not reinterpret in code)

1. `YaoYao_AI_PRD_0.1_Frozen`
2. `YaoYao_AI_Core_Constitution_0.1_Frozen`
3. `YaoYao_AI_Technical_Architecture_0.1`
4. `YaoYao_AI_Core_Data_Model_State_Machine_0.1`
5. `YaoYao_AI_Prompt_Context_Agent_Runtime_Specification_0.1`
6. `YaoYao_AI_MVP_Product_Specification_0.1`
7. `YaoYao_AI_MVP_001_Core_Foundation_Handoff_0.1`
8. `MVP-001 Technical Proposal v0.1` (approved for implementation)

Core invariants: `LLM ≠ YaoYao`. Relationship is permanently `deep_partner` /
`active` / `termination_allowed = false`. Event, Memory, and State are separate
systems. The database is the persistence layer, not the business-rule authority.

## Repository layout

```text
yaoyao-ai/
├── apps/
│   ├── api/            # NestJS HTTP host — bootstrap only, no business rules
│   └── worker/         # BullMQ host — no queues registered in MVP-001
├── core/
│   ├── domain/         # aggregates, value objects, invariants — stdlib ONLY
│   ├── application/    # use cases, ports, transactions — depends on domain only
│   ├── infrastructure/ # postgres, redis, auth, observability, provider seams
│   └── api/            # HTTP surface: controllers, DTOs, guards, errors
├── db/migrations/      # forward-only reviewed SQL (Phase 3+)
├── tests/              # unit / integration / e2e / contract
├── deploy/             # docker-compose, Dockerfiles
└── scripts/            # CI helpers (boundary gate)
```

Dependency direction: `apps → http → application → domain ← infrastructure`.
Enforced by dependency-cruiser (`npm run boundaries`) and CI.

## Quickstart

```bash
nvm use            # 24.20.0
npm ci
npm run build
npm run boundaries
npm test
```

Run the API (Phase 1 — health endpoints only):

```bash
cp .env.example .env
npm run build
node apps/api/dist/main.js
# GET http://localhost:3000/health/live
# GET http://localhost:3000/health/ready
```

## Scripts

| Script               | Purpose                                              |
|----------------------|------------------------------------------------------|
| `npm run build`      | TypeScript project-references build                  |
| `npm run lint`       | ESLint                                               |
| `npm run boundaries` | dependency-cruiser architecture gate (CI-required)   |
| `npm test`           | all Vitest suites                                    |
| `npm run test:unit` / `test:contract` / `test:e2e` | layered suites |
| `npm run ci`         | lint → boundaries → build → test (local gate)       |

## Phase status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 · Scaffolding | workspace, TS, Nest hosts, CI, boundaries, config, pino | this phase |
| 2 · Domain | aggregates, invariants, unit/property tests | pending review |
| 3 · Persistence | migrations, repositories, RLS, append-only | pending |
| 4 · API + auth | JWT, guards, endpoints, OpenAPI | pending |
| 5 · Initialization | idempotent bootstrap transaction | pending |
| 6 · Sessions + state | session lifecycle, state CAS | pending |
| 7 · Replay | pure replay service, internal endpoint | pending |
| 8 · Hardening + deploy | compose, backup/restore, runbook | pending |

Each phase merges only after its exit evidence is recorded. No phase may
weaken an MVP-001 invariant or pull MVP-002+ behavior forward.
