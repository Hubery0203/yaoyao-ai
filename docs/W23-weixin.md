# W-2 + W-3 — personal Weixin text channel

## Scope

One scanner-owned ClawBot chat, linked to an existing authenticated YAOYAO account by a single-use code (16 random hex characters, 10 minute expiry). The client is explicitly YAOYAO AI. Normal chat uses the existing ConversationOrchestrator, owner, event history, model selection, memory retrieval and continuity jobs. No second persona or separate memory database.

Activation has a durable timestamp cutoff. Messages older than that time, messages with no usable source timestamp, other senders, group messages, media and partial messages are ignored. Restart keeps the cutoff and cursor. This release supports text only. The Weixin display name/avatar remain whatever the phone shows.

## Operation

Set `WEIXIN_ENABLED=1` and an absolute `WEIXIN_CREDENTIALS_FILE` in the private API environment. The existing W-1 credentials JSON contains `base`, `token`, `botId`, `ownerId`; its directory must be 0700 and file 0600. Symlink credential files are rejected. Never copy credentials into the repository or browser.

Log in to the original YAOYAO account, open Settings / 微信聊天, generate a code and send `绑定 CODE` to 微信 ClawBot. Refresh status to confirm. A different website account cannot replace an existing binding. Reassigning the scanner or core account is an operator task, not a chat command.

One embedded worker runs inside the API. A separate PostgreSQL session advisory lock prevents two live receivers for the bot; the shared API pool remains capped at 2 on the lightweight VPS. The lock needs one additional PostgreSQL connection. On lock connection loss processing fails closed; restart the API after investigating. A shared LiteRuntime gate serializes Weixin model generation, website generation and continuity work.

Pause stops further generation and polling; an active request may finish. Resume continues pending and unread messages; it does not establish a new cutoff. No background polling of delivery status is needed in the browser; use Refresh.

## Durable state and retry rules

Migration 0006 adds three tables under bot-scoped forced RLS. Runtime transactions pin the configured bot ID; authenticated HTTP operations separately compare the bound core user. Codes are hashed, atomically consumed and never included in status. Context tokens and raw sender IDs are not projected by HTTP or logged.

Receive transactions insert the inbox and advance the cursor together. Duplicate messages share an exact uint64-derived hash. At most 100 unresolved messages are allowed; a full batch rolls back without advancing the cursor. Core request IDs are deterministic and replay a committed turn after crashes. Generated replies are stored before sending.

States: pending → generating → ready → sending → accepted. Generation gets three attempts; explicit send rejection gets bounded exponential backoff and at most five attempts, with the combined attempt counter including generation. A restart recovers generating as pending; sending becomes uncertain. Network errors, HTTP failures other than explicit auth/rate rejection, invalid success bodies and interrupted sends become uncertain. Uncertain/failed messages block later deliveries until their owner resolves them in Settings.

`accepted` means API/HTTP acceptance, **not phone receipt**. A successful HTTP response may omit `ret`; this is accepted without automatic resend. Unknown delivery cannot be made exactly once by this application. Owner retry displays a duplicate warning and reuses the saved reply/client ID; phone deduplication is not assumed. Owner can confirm receipt, explicitly retry, or skip.

Expired authorization pauses until operator refreshes the private credential file; changing the token and restarting clears only the authentication pause. Core binding, cutoff and queue stay intact. Stop sends best-effort lifecycle notification; sending interruptions remain reviewable.

## Deployment / rollback

Back up PostgreSQL, apply forward migration 0006 explicitly with administrator credentials, then start the CI-built API with the flag enabled. Keep existing ports, Nginx, API/slice memory limits and other VPS services unchanged. No OpenClaw service, Redis service, new listener or local long-running runtime is required.

Fast operational rollback: set `WEIXIN_ENABLED=0`, restart this release. Website and Core remain usable, durable inbox and binding stay in PostgreSQL. Do not automatically restore an older database snapshot: that could erase chats accepted after deployment. For binary rollback to 006AB, first verify schema compatibility or use a prepared compatibility release that includes migration 0006; the startup checker rejects unknown migration heads. No destructive down migration.

## Protocol source

Tencent official client protocol: https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md (consulted 2026-10-24). Client compatibility fields do not establish a complete server contract. W-1 phone-confirmed the original authorization and one text reply; W-2/W-3 phone binding and real-model acceptance remain a separate deployment gate.
