# MVP-004 v1 — local text web client

## Delivered scope

- Chinese responsive chat UI with registration, login, logout and tab-scoped session restoration.
- Plain-text messages, loading state and recoverable failures. A pending turn retains its Idempotency-Key across retry/reload; reusing a key with different text returns HTTP 409.
- Owner-scoped persisted history: most recent 100 messages, earlier-page loading, search within loaded messages.
- Consolidated memories, more-memory loading, and explicit confirm/discard for held candidates from the latest 100 audit records.
- Backend/model status, a local nickname and Enter-to-send preference. Mock is explicitly labeled.
- No frontend model keys, external asset/CDN requests, or new runtime dependencies.

## Start

1. Use Node 24. Run `npm ci` then `npm run build`.
2. Provision PostgreSQL and migrations, configure the API and start it following [MVP-003-RUNBOOK.md](MVP-003-RUNBOOK.md). The web client needs a working authenticated API; it does not create a database or substitute demo data.
3. Start the client with `npm run web`, then open http://127.0.0.1:4173.
4. If the API uses another local port, set `YAOYAO_API_URL=http://127.0.0.1:3001 npm run web`. Set `WEB_PORT` to change the UI port. Both the web listener and API proxy target are restricted to loopback.
5. Create an account or sign in. For new memories, add the resulting owner UUID to `CONTINUITY_USER_IDS` and start/restart the worker as described in the 003 runbook.

The API provider and model remain configured on the server. A disconnected API is shown as disconnected; a configured mock provider remains a mock. Real model configuration and real-provider acceptance require the operator's own environment and credentials.

## Data and behavior

Access tokens are held in memory; refresh tokens and unresolved sends use sessionStorage and survive refresh within the same tab. Closing the tab normally ends that local session; browsers may restore tab storage when restoring a browsing session. Preferences alone use localStorage. Logout attempts server revocation and clears the local token, pending send, compose text, history and memories even if revocation cannot be confirmed.

A successful turn is reloaded from the canonical event history. The backend checks the original text on completed replay and persists the first committed assistant reply under concurrent retry. Messages are rendered with textContent, never interpreted as HTML. History currently reads the owner's event stream before paging; large-scale indexed history and concurrent pagination stabilization are follow-up work.

## Verification

`npm run lint`, `npm run boundaries`, `npm run build`, `npm run test:unit`, `npm run test:contract`, `npm run test:web`.

With Docker: `npx vitest run tests/integration` and `npm run test:e2e`. CI runs these plus API/worker image builds. The new API integration contract covers retry, changed-body conflict, owner isolation, authentication, history and sanitized connection metadata.

Browser acceptance uses an isolated synthetic backend solely to exercise UI login, a failed send, retry, refresh restoration, history, provider display and logout. It is not the delivered API and is not evidence of a live model connection.

## Follow-up scope

Streaming output, voice, media, public hosting, model switching, indexed history, memory audit pagination, account recovery and account deletion are outside this first version. This branch is stacked on MVP-003; review and merge 003 before retargeting 004 to main.
