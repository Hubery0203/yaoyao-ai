# YaoYao AI · Persistent Companion Backend

Persistent digital companion core — 沈知遥 / 遥遥.

MVP-001 establishes YaoYao as a **persistent system entity**: durable identity,
permanent relationship, versioned state, append-only event history, memory
foundation, session lifecycle, authorization boundaries, and read-only replay.
It deliberately contains **no LLM calls and no companion behavior** — those are
later milestones built on this foundation.

Engineering priority: Identity > Relationship > State > Memory > Event > Runtime > LLM > UI.

## Local text web client (MVP-004 v1)

Run `npm run web` after starting the configured API. Open http://127.0.0.1:4173
for login, chat, persisted history, memory review and connection preferences.
See [MVP-004 setup and scope](docs/MVP-004-TEXT-WEB.md).

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
│   ├── web/            # local text UI and same-origin loopback proxy
│   └── worker/         # owner-scoped Postgres continuity worker
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

Run the API (after configuring runtime credentials and applying migrations):

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

## Project status

| Milestone | State |
| --- | --- |
| MVP-001 | Core persistence, API and owner isolation present |
| MVP-002 A–G | Conversation runtime, providers, emotion, decisions, retrieval present |
| MVP-003 A | Durable continuity jobs reconstructed from surviving 002G |
| MVP-003 B | Grounded memory engine, correction history, candidate audit/review |
| MVP-003 C | Time-aware emotion evolution with CAS and traceable events |
| MVP-003 D | Postgres continuity worker, internal reflection, bounded retries |
| MVP-003 E | Integration/HTTP/worker acceptance suites; see latest CI |

MVP-003 is implemented against [recovery baseline v1](docs/MVP-003-IMPLEMENTATION-BASELINE.md),
authorized after the original local files were lost. It is a backend milestone.
See [the worker runbook](docs/MVP-003-RUNBOOK.md) for configuration, owner review,
retry recovery, test commands and deployment prerequisites.

The original Phase 1–8 table described MVP-001 implementation steps and has
been replaced with this milestone-level status. A passing test run is scoped
to its exact commit; production rollout is a separate operation.
