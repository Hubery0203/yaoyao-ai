# deploy/

Hardened single-VPS deployment (Technical Proposal §14).

- `docker-compose.yml` — postgres (pgvector/pgvector:0.8.0-pg16) + redis (7.4.1)
  on a private network; api + worker built from pinned `node:24.20.0-alpine`.
- `api.Dockerfile`, `worker.Dockerfile` — multi-stage, non-root runtime user.

Production controls (to be completed in Phase 8):
- TLS reverse proxy in front (only 80/443 public); api binds localhost here.
- Secrets from root-owned files / VPS secret facility; never committed.
- Separate migration job before API rollout; startup refuses incompatible schema.
- Nightly encrypted backups + off-host copy; restore drill before acceptance.

Growth path: move PostgreSQL to a managed service and containers to a managed
platform later. Ports, migrations, event schemas, and aggregate contracts stay
the same — no product contract changes required.
