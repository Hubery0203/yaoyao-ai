# W-1: bounded Weixin text-channel probe

Reference checked on 2026-10-24: Tencent/openclaw-weixin 2.4.10, upstream protocol and API implementation:
- https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md
- https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.ts
- https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/login-qr.ts

This is an independent compatibility probe, not the official plugin. Client documentation does not establish the complete server contract. Actual account authorization and message receipt must be verified by the human.

## Scope

Three short-lived commands: `qr`, `login`, `listen`. Node24 built-ins only. `W1_DIR` selects an isolated private directory; all state files use 0600 and the directory uses0700. QR preparation refuses to overwrite an existing authorization. Do not publish state files or upload them to GitHub.

Login uses the official HTTPS endpoints, trusted Weixin origins, no silent HTTP redirects, bounded response bodies, request timeouts and a five-minute client login window. The human scans and authorizes on their phone; the program never approves phone permission prompts. A pairing-code request pauses login until a private `verify-code.json` contains a human-provided `code`. The code is not logged and is consumed after one response.

Listen exits after one acknowledged test reply, after a ten-minute window, or on authentication/rejection errors. It only accepts a pure text test challenge from `ilink_user_id` returned by that QR authorization. Group, bot, foreign-sender and other-content messages are ignored without retaining their text. Reply includes the inbound context token and a stable client ID. A private journal records attempted delivery before the network call; ambiguous delivery stops automatic resending rather than claiming external exactly-once delivery.

The one reply is an explicitly labelled fixed YAOYAO AI transport test. No DeepSeek, existing YAOYAO auth credentials, personal memories, DB, media, browser automation or HTTP listener. W-2 is responsible for actual companion/account integration.

## Local checks

`node --test tools/weixin-w1/probe.test.mjs`

Mock checks cover trusted hosts, peer/challenge restrictions, no token in reply, explicit send ACK, replay/ambiguous send handling, API headers, response bounds, private files and redacted console output. They do not prove real Weixin access or delivery.

## VPS run

Requires a concrete approved operation assessment. Use existing unprivileged `yaoyao` user, private `/var/lib/yaoyao-weixin-w1`, and transient systemd commands with MemoryHigh64M, MemoryMax96M, MemorySwapMax32M, CPUQuota10%, request/overall deadlines and write access only to the probe state directory. No existing API restart, port, database schema, proxy, container or permanent daemon changes.

Name/avatar customization, the phone entry UI and token lifetime are not established by these endpoints. Record actual observations instead of assuming ordinary friend-account behavior. After completion keep the authorized token private for an explicitly approved W-2 handoff, or revoke through the phone if the user chooses.

## Live W-1 findings (2026-10-24)

QR authorization worked and the human reported the conversation name as 微信ClawBot. A real inbound message used a numeric 64-bit message_id beyond Number.MAX_SAFE_INTEGER. JSON parsing now preserves its original decimal source as a string before constructing a stable delivery key. Start/stop lifecycle notifications follow the current official client.

The human confirmed receiving the fixed reply on the phone. The response did not establish the originally expected `ret:0` acknowledgement; this is recorded separately from phone-confirmed delivery, and no retry was sent. The final probe distinguishes explicit ret/errcode success from an unconfirmed HTTP response, and recognizes a human-confirmed journal entry as completed. Current synthetic coverage:12 checks.

Name/avatar customization was not established. The test process exits after this single exchange. Existing YAOYAO account/DeepSeek/memory integration remains W-2.
