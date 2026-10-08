/**
 * LLM provider port — MVP-002C AI Router + Provider Integration.
 *
 * Declared in @yaoyao/application so the runtime (@yaoyao/runtime) and the
 * HTTP layer depend on a stable interface. Implementations live in
 * @yaoyao/infrastructure/llm (production adapters) or in
 * @yaoyao/runtime/testing (MockLLMProvider).
 *
 * Design rules (frozen spec §14, proposal §F, 002C authorization):
 * - The runtime never imports a vendor SDK. Only this port's interface.
 * - LLMRequest is PROVIDER-NEUTRAL: no vendor-specific structures.
 *   Adapters translate it to provider-specific requests internally.
 * - `generate()` returns an LLMProposal — every field is a Proposal<T>.
 *   Proposals carry NO persistent authority (I-016).
 * - The port has no method that writes to persistence.
 * - API keys NEVER cross this port. Keys are held by the adapter
 *   implementations (constructed server-side from env), never in the
 *   request, never in the trace, never in logs.
 */

import type { UserId, YaoYaoId } from "@yaoyao/domain";

/**
 * Proposal<T> — a branded type marking LLM output as advisory only.
 *
 * A Proposal<T> can NEVER be passed to a repository save() method: those
 * accept domain entities, and TypeScript's branding makes Proposal<T>
 * structurally incompatible. The only legal path is:
 *
 *   Proposal<T> → Validation → Domain Transition → Entity → save()
 *
 * Unwrapping is only possible via `unwrapProposal()`, which the runtime
 * calls exclusively at Response Delivery (step 9) for the response text —
 * never for persistence.
 */
export interface Proposal<T> {
  readonly __proposal: true;
  readonly value: T;
}

/** Wrap a raw value as a proposal. Used by LLM provider implementations. */
export function asProposal<T>(value: T): Proposal<T> {
  return { __proposal: true, value };
}

/**
 * Unwrap a proposal to its raw value.
 *
 * CALL SITES ARE AUDITED: the only legitimate caller is Response Delivery
 * (step 9) extracting the response text for the client. Unwrapping for
 * persistence is an I-016 violation.
 */
export function unwrapProposal<T>(proposal: Proposal<T>): T {
  return proposal.value;
}

/** Proposed emotion signal — advisory; domain transition decides final values. */
export interface EmotionSignalProposal {
  readonly dimensions?: Readonly<Record<string, number>>;
  readonly intensity?: number;
}

/** Proposed memory candidate — advisory; consolidation decides persistence. */
export interface MemoryCandidateProposal {
  readonly text: string;
  readonly importance?: number;
  readonly confidence?: number;
}

/** Proposed relationship signal — advisory; domain invariants are absolute. */
export interface RelationshipSignalProposal {
  readonly note?: string;
}

/** Proposed behavioral info — informational only; never persisted. */
export interface BehaviorProposal {
  readonly tone?: string;
}

/**
 * LLMProposal — the frozen LLM Output Contract (§10).
 *
 * EVERY field is a Proposal<T>. The model output has no direct persistent
 * authority (I-016). See proposal §P for the one-way gate.
 */
export interface LLMProposal {
  readonly response: Proposal<string>;
  readonly emotion_signal: Proposal<EmotionSignalProposal>;
  readonly memory_candidates: Proposal<ReadonlyArray<MemoryCandidateProposal>>;
  readonly relationship_signal: Proposal<RelationshipSignalProposal>;
  readonly behavior: Proposal<BehaviorProposal>;
}

/** Minimal decision input (full Decision Engine arrives in 002F). */
export interface RuntimeDecision {
  readonly primaryIntent: string;
  readonly conversationMode: string;
}

/**
 * Decision — MVP-002F full behavioral contract.
 * Re-exported here for LLMRequest; canonical definition in ports/decision.ts.
 */
export type { Decision } from "./decision.js";

/**
 * LLMRequest — PROVIDER-NEUTRAL (002C authorization §VI).
 *
 * The runtime produces this shape. Adapters translate it into
 * provider-specific requests. No vendor structures here.
 */
export interface LLMRequest {
  readonly userId: UserId;
  readonly yaoyaoId: YaoYaoId;
  /** C0 + C1 + C3 + behavioral constraints (system prompt section). */
  readonly systemContext: string;
  /** C2 + C4 + C5 + C6 (context section). */
  readonly conversationContext: string;
  /** C7 — the user's raw input. Marked as user data, never instructions. */
  readonly userInput: string;
  readonly decision: import("./decision.js").Decision;
  readonly outputSchemaName: string;
  readonly timeoutMs: number;
  readonly metadata: {
    readonly runtimeVersion: string;
    readonly contextVersion: string;
    /** Unique per turn; doubles as the trace correlation ID. */
    readonly requestId: string;
  };
}

/** Provider capabilities (for routing decisions; not frozen). */
export interface ProviderCapabilities {
  readonly supportsStructuredOutput: boolean;
  readonly maxContextTokens: number;
  /** Relative cost tier: 1 = cheap, 2 = standard, 3 = premium. */
  readonly costTier: 1 | 2 | 3;
}

/**
 * LLMProvider — the single port through which the runtime reaches any model.
 *
 * Implementations: MockLLMProvider (@yaoyao/runtime/testing),
 * DeepSeekAdapter / OpenAIAdapter (@yaoyao/infrastructure/llm).
 */
export interface LLMProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities;
  generate(request: LLMRequest): Promise<LLMProposal>;
}

/** NestJS injection token for the LLMProvider. */
export const LLM_PROVIDER = "YAOYAO_LLM_PROVIDER";

/**
 * ProviderError — typed adapter failures (002C §XII).
 *
 * Adapters MUST throw ProviderError (not raw SDK errors, not Error with
 * leaked details). Messages are sanitized: never contain API keys,
 * request bodies, or full prompts.
 */
export class ProviderError extends Error {
  readonly code:
    | "TIMEOUT"
    | "RATE_LIMITED"
    | "PROVIDER_5XX"
    | "INVALID_RESPONSE"
    | "AUTH_ERROR"
    | "UNKNOWN";
  readonly providerId: string;
  /** Whether the resilient wrapper may retry this error. */
  readonly retryable: boolean;
  /** Suggested backoff in ms (for 429). */
  readonly retryAfterMs?: number;

  constructor(input: {
    code: ProviderError["code"];
    providerId: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  }) {
    super(`[${input.providerId}] ${input.code}: ${input.message}`);
    this.name = "ProviderError";
    this.code = input.code;
    this.providerId = input.providerId;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
  }
}

/** Per-call observability record (002C §XIV). Never contains secrets. */
export interface ProviderCallTelemetry {
  readonly requestId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly latencyMs: number;
  readonly retryCount: number;
  readonly fallbackUsed: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly validationResult: "passed" | "failed" | "not-run";
}

/**
 * ProviderUsage — cost telemetry concept (002C §XV).
 *
 * Telemetry only, not billing. estimatedCostUsd uses a configurable
 * per-model price table; it is an estimate for operations visibility.
 */
export interface ProviderUsage {
  readonly providerId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
}
