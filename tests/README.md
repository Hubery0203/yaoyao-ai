# tests/

| Directory     | Purpose                                                        | Phase |
|---------------|----------------------------------------------------------------|-------|
| `unit/`       | Fast domain/application unit tests (Vitest, no I/O).           | 2+    |
| `integration/`| Real PostgreSQL 16 + pgvector via Testcontainers. Transactions, RLS, locking, migrations, replay queries. | 3+ |
| `e2e/`        | Full-stack API tests (Supertest): auth, ownership, idempotency, forbidden routes, error envelope. | 4+ |
| `contract/`   | Architecture boundaries (dependency-cruiser), OpenAPI snapshots, migration checksums, event schema compatibility. | 1+ |

Merge rule (Technical Proposal §13): T001–T012 and architecture checks are
required. A route returning 200 without asserting domain postconditions is
not acceptance evidence.
