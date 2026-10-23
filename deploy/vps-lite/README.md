# Existing 512 MB VPS: restricted single-user trial

This profile uses the host's Nginx, a native Node API with LITE_MODE=1, and one PostgreSQL container. Do not start the standard Compose stack on this host.

## Layout and controls

- `/opt/yaoyao-ai/releases/<sha>`: immutable source release, bundled Linux x64 Node executable and production dependencies from CI artifact `yaoyao-linux-x64`.
- `/opt/yaoyao-ai/current`: active release symlink. Static root is `apps/web`; only `/`, `/app.js`, `/style.css` are served.
- `/opt/yaoyao-ai/private`: root-only environment files and migration snapshot. Never commit these files.
- `yaoyao-api.service`: dedicated unprivileged user; shared `yaoyao.slice` with PostgreSQL. Group MemoryHigh=192M, MemoryMax=256M, MemorySwapMax=256M, CPUWeight=25.
- PostgreSQL `pgvector/pgvector:0.8.0-pg16`: persistent named volume `yaoyao-pgdata`, loopback 55432, memory128M/swap-total192M, CPU0.5. Shared buffers16MB, work_mem1MB, maintenance_work_mem16MB, max_connections12, max_parallel_workers0, jit off, wal_buffers1MB, max_wal_size128MB.
- API: loopback4300, Node heap64M, service memory192M, pool2, one active conversation or continuity task, idle scheduler30s. Argon2 retains original parameters; login concurrency limited to1 in Nginx.
- Environment: production, LITE_MODE=1, PG_POOL_MAX=2, four LLM tiers configured to DeepSeek; explicit migrated owner allowlist. JWT secret and database passwords live in private files.
- No public registration. Keep expected `switch-auth` DOM node hidden/disabled in deployed HTML; Nginx rejects `/api/v1/users`.

## Installation order

1. Back up `/etc/nginx` and record existing service/HTTPS baseline. Verify SSH host fingerprint and disk/RAM headroom.
2. Create isolated directories/user/slice. Pull the pinned PostgreSQL image, initialize fresh database, wait for final TCP readiness (the image first starts a temporary Unix-socket server).
3. Prepare missing `yaoyao_app` and `yaoyao_readonly` roles. Quiesce source API/worker, make `pg_dump -Fc`, record counts, send over SSH, restore only into an empty target. Preserve all migrations/checksums, user hashes, events, memories and jobs.
4. Download CI artifact for reviewed SHA, verify SHA256, unpack outside private directories and verify RELEASE.json and native Argon2 loading. VPS does no npm install or build.
5. Install API unit/environment, check readiness and row counts. Database app role remains NOSUPERUSER/NOBYPASSRLS.
6. Add hostname to existing ACME HTTP01 site, `nginx -t`, reload. Issue/install dedicated certificate using existing acme.sh and its renewal account.
7. Add exact hostname to existing stream SNI map -> existing `web_https` upstream. Install `nginx.conf` as isolated enabled site. `nginx -t` before every reload; retain default proxy route.
8. Validate HTTPS login/history/real model/idempotency/background memory/restart persistence. Recheck existing services against baseline and observe30min: no OOM, no sustained swap thrashing, target available RAM64MiB+.
9. Stop source PostgreSQL only after cloud is accepted; retain local offline backup/source.

## Operation and recovery

Use `systemctl status yaoyao-api`, `systemctl show yaoyao.slice -p MemoryCurrent -p MemoryPeak`, `docker stats --no-stream yaoyao-postgres`, `free -m`, and cgroup `memory.events`. Logs must not include environment values or user messages.

Back up via `docker exec yaoyao-postgres pg_dump -U yaoyao_admin -d yaoyao -Fc`, save root-only, verify restore periodically. Bound retention and disk usage. Existing server-wide backup/monitor tasks are separate; confirm coverage before relying on them for this volume.

Rollback before cloud writes: stop new services, restore the saved Nginx configuration for this change only and reload after checking. If cloud accepted writes, first stop cloud API, dump and copy its database back, verify/restore in a fresh local cluster, then resume local writers. Never start an old local snapshot against diverging cloud data.

No whole-machine restart, existing-service adjustment or resize is part of this profile.30min trial acceptance is not a long-term capacity guarantee.
