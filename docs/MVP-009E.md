# MVP-009E — reference-based photos over Weixin

Implementation candidate; no production migration, paid image API check or deployment is implied by this document. 009A–D are outside this change. 006C remains postponed; proxy/public website/outreach settings stay unchanged.

The owner supplies a reference image. A neutral headshot derived with the built-in image tool is kept privately outside the repository. No default face substitutes for that reference. OpenAI Image Edits receives only that image and the explicit current scene, never the user's conversation, memories or credentials. The generated scene is fictional and does not become an asserted physical activity.

## Usage

Send one standalone message: `发张自拍给我`, `给我拍张照片`, `想看你穿毛衣的样子`, or `照片：穿毛衣在窗边微笑`. The command is isolated from burst batching. Ordinary photo mentions, quotes, negations and multiline combined requests do not trigger a paid image call. Each request produces at most one medium-quality 1024-square JPEG. An ordinary unsupported phrase still goes through text conversation; this first version is deliberately explicit rather than model-decided tool use.

Image sending uses one image item; the conversation history records `[AI生成图片]`, not a fabricated caption or scene. History currently has no public image viewer. On a failed/unknown image delivery, `跳过照片` releases blocked photo jobs without a website. This cannot retract an already-started send. `取消回复` also fences final sending for pending/generating/ready messages. Cancellation after a provider attempt starts does not undo incurred use.

## Provider and deployment configuration

Default `PHOTOS_ENABLED=0`. Enable only after owner approval and live transport checks. Separate private variables: `OPENAI_IMAGE_API_KEY`, `OPENAI_IMAGE_MODEL`, `PHOTO_REFERENCE_FILE`, `PHOTO_STORAGE_DIR`, `PHOTO_MAX_PER_24H` (default 3, range 1–5). No fallback to a chat model key or third-party endpoint. Default image model `gpt-image-2.5-sunburst`, configurable within the verified supported set; account access remains to be tested. Reference and its containing directory must be private (0600/0700), absolute paths, no symlink file. Never commit images or secrets.

API uses the fixed official `/v1/images/edits` origin, one multipart reference, `n=1`, `moderation=auto`, JPEG medium quality. No automatic provider retries, remote reference fetch, returned URL fetch, model routing or extra text-model call. Errors returned to users contain no provider body, key, prompt or credentials. Each reservation counts conservatively toward a rolling 24-hour attempt cap, including refusals, failures and uncertain results; this is an attempt cap, not a currency spending guarantee. A 60-second cooldown also applies. Set a provider project budget separately for monetary control.

Reference and output max 4MiB; provider response bounded to 6MiB before decode. Private spool refuses new work beyond 28MiB and lazily deletes only its own hash-named artifacts and UUID temp files older than 24 hours on the next photo operation. It is temporary delivery storage, not a permanent album. No extra listener, resident worker, native image library, database blob or public image URL.

## Durable boundaries

Forward migration 0009 adds one FORCE-RLS channel-scoped `weixin_photos` table with owner ID and composite inbox reference. Reservation locks the real channel and source inbox row, verifies owner/reactive stage, applies cooldown/quota and inserts one unique attempt before the provider request. Replaying an existing reserved attempt never grants another paid request.

States: reserved → generated (private artifact hash) → uploaded (encrypted media reference), or failed. Failure/unknown provider outcome is terminal for that request. DB failure after provider success cannot authorize a second generation. CDN upload may retry using an existing generated artifact without generating again. Sending reuses the existing durable outbox and stable client ID. Unknown sending/restart-during-send becomes uncertain and is never automatically resent. An explicit owner retry may duplicate an actually delivered image, as with existing text resolution; do not claim exactly-once mobile delivery.

Photo generation and upload run within the existing single delivery gate; polling continues. Other delivery waits while a photo is prepared (up to a 120-second provider timeout and bounded upload). One photo at a time limits memory and cost; this is not a latency optimization. Shutdown aborts outstanding image requests. Final atomic beginSend prevents delivery after cancellation/pause. Image history is idempotent and bypasses the text LLM; continuity skips both long-term extraction and recent-life inference from photo commands, even when a command contains fictional first-person facts.

## Verification and recovery

Unit checks cover explicit intent, no provider before reservation, uncertain generation recovery, artifact/upload retry, fixed origins/redirect rejection, response limits, private files, encryption and base64-of-hex wire keys. Real PostgreSQL/API checks cover racing reservations, cooldown/rolling cap, channel/owner isolation, receiver restart, outbox and history replay, fictional-scene exclusion, owner skip and cancellation.

Deploy only after CI, Linux release verification and scoped owner approval. Freeze API, verify backup, lock and apply 0009 with old-table row comparisons, preserve binding/cutoff/cursor/deliveries; do not touch proxy/nginx/certificates/ports/limits. Restart recovery must verify photo reservations cannot re-charge. Never restore a frozen old database over new chats. The original 008 binary rejects unknown 0009; a compatible 008 rollback needs the exact 0009 migration file for compatibility checking and must pause Weixin so photo outbox items cannot be mis-sent as ordinary text. Keep the new table and all live data.

## Protocol sources

- OpenAI Image Edits: https://developers.openai.com/api/reference/resources/images/methods/edit
- OpenAI image guide: https://developers.openai.com/api/docs/guides/image-generation
- Tencent Weixin media upload and encryption: https://github.com/Tencent/openclaw-weixin/blob/main/src/cdn/upload.ts
- Tencent single-item image send and key encoding: https://github.com/Tencent/openclaw-weixin/blob/main/src/messaging/send.ts
- Tencent CDN origin: https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/accounts.ts

These are source references, not permission to run paid calls, upload a user's private reference or send unsolicited messages.
