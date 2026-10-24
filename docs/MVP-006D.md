# MVP-006D — conversation tuning and bounded resource use

Status: implementation and local regression completed; CI and approved deployment gate pending. The approved 24-turn synthetic model comparison was completed before the final memory-receipt guard; its observed receipt wording is now covered by deterministic regression, and its latency/usage totals are not a final-release performance claim. 006C mobile/chat UI work is deferred. W-2/W-3 remains the production baseline.

## Dialogue

- Compact continuity guidance keeps receipt-time grounding, object-specific negation, explicit topic changes, short-answer resolution and evidence-based recall.
- Give direct factual answers, natural acknowledgments and at most one useful follow-up. Avoid habitual intimacy prefixes, speculative physical actions and announcements that a new fact is already durably stored.
- For a fresh literal name/location/preference statement, the continuity gate rejects claiming 记住了/记下了/已经保存 before a Core receipt; grounded recall, quoted and negated wording remain permitted. This rule addresses the actual comparison sample and uses the existing single repair, then fallback.
- For a literal statement of 6–200 normalized characters repeated among the last three user turns, acknowledge or continue naturally. A narrow continuity check rejects motive probes such as asking why the user repeats it or whether they are testing YAOYAO. Explicit repetition requests and questions about causes are excluded. This is a bounded lexical rule, not semantic understanding of all paraphrases.

## Context

- Current input is carried in C7 and no longer appended a second time by the provider adapter. The provider-neutral request still carries the original input for classification and other implementations.
- Budget estimation charges ASCII/4, CJK*1.5 and other UTF-16 units. It is a heuristic, not actual tokenization or a bill.
- Reserve 1,200 estimated input tokens for appended decision, continuity and schema instructions. C0/C1/C7 retain their existing non-droppable priority, including explicit overrun when mandatory input alone exceeds the soft budget.
- C6 keeps a recent suffix within up to 2,400 estimated tokens. It allows room for current retrieved memories/persona/events while retaining a minimum history allocation when available. A single oversized newest message can be represented by an explicitly marked partial suffix; partial excerpts are not independent facts. Full persisted history is unchanged.
- Trace records included/dropped history counts and partial-message use.
- Persona context reuses the already resolved aggregate instead of loading it again for the bounded event read. No cross-user context cache is introduced.

## Model execution

- One SDK client per configured provider in each API instance. Present configuration uses one model/key per provider across tiers; this reuse must be revisited if per-tier models/credentials are introduced.
- SDK `maxRetries=0`; the Runtime owns retry decisions. Default primary retry remains one. An identical reused provider is not invoked again as fallback. A genuinely separate fallback provider remains supported.
- Each invocation shares its timeout across attempts and backoff. A valid Retry-After longer than the configured wait limit is deferred, never shortened into an early retry. Numeric seconds and HTTP dates are parsed.
- Conversation generation, optional one-pass repair and emotion interpretation share a default 45,000ms model budget. Each next call receives the remaining timeout. This is a model-call budget, not a hard deadline for database work or the full HTTP/Weixin journey. SDK adapters must honor the supplied timeout.
- If the shared budget is exhausted, no further repair/emotion call starts. An already accepted reply is still persisted/delivered; emotion is not reset and the skipped interpretation is reported. Failed initial generation retains the existing retry-safe request semantics.
- `CONVERSATION_MODEL_BUDGET_MS=45000`; `CONVERSATION_OUTPUT_TOKENS=2000`; `EMOTION_OUTPUT_TOKENS=512`. These are server policies with validated bounds. Dialogue output cap is unchanged by default; the dedicated emotion JSON has a smaller cap.

## Observability

Keep `quality-v1` and add one `performance-v1` summary for committed generation/replay, tagged web or Weixin. Include Core turn/context/emotion time, returned-invocation attempt counts, history window metadata, successful completion usage and process RSS/heap MiB. Never log prompts, replies, binding codes, context tokens, user IDs, request IDs or API keys through these summaries.

Usage is attached to proposal objects in a WeakMap owned by the adapter, separate from all Core-authoritative proposals. Metrics do not become Core facts. Successful usage includes successfully parsed generations/repairs/interpreter outputs only; failed requests and invalid/truncated completions may still incur usage and are not included. Attempt counts cover invocation chains that returned telemetry; failed emotion invocations are separately counted. These figures are not a total bill. Core latency excludes Weixin receive queue and send network delay. Logging cannot fail a committed reply.

## Validation gate (pending)

After authorization, add/run focused and full regression covering repeated-statement probes, legitimate cause questions, memory wording, time/negation/topic continuity, CJK/emoji budgets, long history, mandatory-layer overrun, single-copy C7, shared provider reuse, no nested retries, Retry-After, total remaining time and private metric projections. Use isolated synthetic owners for PostgreSQL/API and mock-provider checks. Compare a bounded synthetic corpus against W-2/W-3 using the configured DeepSeek model; record quality, repair/fallback, usage and timing without claiming a percentage improvement in advance.

All CI jobs must pass before preparing a Linux release. Update only the existing API application after explicit VPS approval; no schema migration, new port or resource-limit increase is required. Revert the application to W-2/W-3 if quality, correctness, recovery or resources regress; keep PostgreSQL and Weixin binding/cursor authoritative.

## SDK source

Installed SDK: openai 7.30.0, inspected `src/client.ts` (default retries = 2). Official [TypeScript SDK reference](https://developers.openai.com/api/reference/typescript) and [rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits), consulted 2026-10-24, support disabling nested SDK retries and sharing a bounded retry budget. The actual model remains the configured DeepSeek model.
