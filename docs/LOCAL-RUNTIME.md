# Local PostgreSQL + DeepSeek runtime

The optional native launcher is `node scripts/local-runtime.mjs ACTION`. Node 24 is required. Runtime state defaults to `.local/` under the repository; set `YAOYAO_LOCAL_DIR` for another private directory. Do not put this directory in Git or sync it to a public folder.

## Prerequisites

- A PostgreSQL 16 distribution with pgvector and citext, e.g. the official Postgres.app PostgreSQL 16 bundle. Set `PG_BIN` to its `bin` directory. The default location is `$YAOYAO_LOCAL_DIR/Postgres.app/Contents/Versions/16/bin`.
- Installed project dependencies and `npm run build`.
- A private `deepseek.env` in the runtime directory containing `DEEPSEEK_API_KEY=...` and `DEEPSEEK_MODEL=deepseek-flash`. The launcher reads this on each start. Never paste keys into source files.

The installer must verify the publisher's package/digest and code signature. The launcher does not download binaries, modify the system installation, register login agents or expose a public listener.

## Commands

- `init`: initialize a separate SCRAM-protected PostgreSQL cluster, create the local database, apply checksummed migrations and enable the least-privilege application role. Re-running verifies migration checksums.
- `start`: initialize as needed, start API, Worker and web as background processes. Database/API/web listen only on loopback. Default ports are 55432/4300/4174. All AI routing tiers and the provider fallback use DeepSeek; no mock provider is configured.
- `status`: report database, API, Worker and web availability without credentials.
- `add-owner UUID`: allow the named account's worker processing. Restart afterward. The UUID is shown in the web settings page. No automatic enumeration of private owners.
- `restart`: stop tracked services gracefully and restart with current provider/owner configuration; PostgreSQL data is retained.
- `backup`: save a private PostgreSQL custom-format dump in `.local/backups`. This is database content; retain `runtime.json` separately and privately for complete runtime recovery.
- `stop`: stop tracked services and this specific database cluster, retaining files. PIDs are checked against the expected script before signals are sent.

The first run creates `runtime.json` with independent random database and JWT credentials. Runtime metadata and provider files are mode 0600, their directory 0700. Logs remain local and are not uploaded with code. An existing configuration is reused rather than rotated on every start.

Changing an API key or model requires restart. Generic OpenAI-compatible transport sends DeepSeek's `thinking.type=disabled` for bounded conversational JSON requests. The current model is chosen by operator configuration, independently of the Core identity.

## First use

Open the web URL, create your own account, then copy the user UUID from settings and use `add-owner` followed by `restart`. Background memory extraction processes only allowed owners. An isolated operational check account may be used to verify deployment; it must not be confused with the user's own account.

The local runtime runs until manually stopped or the computer shuts down. It does not start automatically after reboot; use `start` again. This setup does not merge PRs or deploy to public hosting.
