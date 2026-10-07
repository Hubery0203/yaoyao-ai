/**
 * LLM provider port — MVP-002A Conversation Runtime Foundation.
 *
 * Declared in @yaoyao/application so the runtime (@yaoyao/runtime) and the
 * HTTP layer depend on a stable interface. Implementations live in
 * @yaoyao/infrastructure/llm (production adapters) or in
 * @yaoyao/runtime/testing (MockLLMProvider for MVP-002A echo path).
 *
 * Design rules (frozen spec §14, proposal §F):
 * - The runtime never imports a vendor SDK. Only this port's interface.
 * - `generate()` returns an LLMProposal — every field is a Proposal<T>.
 *   Proposals carry NO persistent authority (I-016).
 * - The port has no method that writes to persistence.
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
 * CALL SITES ARE AUDITED: the only legitimate caller in MVP-002A is
 * Response Delivery (step 9) extracting the response text for the client.
 * Unwrapping for persistence is an I-016 violation.
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
 * LLMProposal — the frozen LLM Output Contract (§10), MVP-002A skeleton.
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

/** Minimal decision input for MVP-002A (full Decision Engine arrives in 002F). */
export interface RuntimeDecision {
  readonly primaryIntent: string;
  readonly conversationMode: string;
}

/** Minimal context input for MVP-002A (full C0–C7 assembly arrives in 002B). */
export interface RuntimeContext {
  readonly inputText: string;
  readonly decision: RuntimeDecision;
}

export interface LLMRequest {
  readonly userId: UserId;
  readonly yaoyaoId: YaoYaoId;
  readonly context: RuntimeContext;
  readonly outputSchemaName: string;
  readonly timeoutMs: number;
  readonly traceId: string;
}

/**
 * LLMProvider — the single port through which the runtime reaches any model.
 *
 * Implementations: MockLLMProvider (@yaoyao/runtime/testing, MVP-002A),
 * future production adapters in @yaoyao/infrastructure/llm.
 */
export interface LLMProvider {
  readonly providerId: string;
  readonly modelId: string;
  generate(request: LLMRequest): Promise<LLMProposal>;
}

/** NestJS injection token for the LLMProvider. */
export const LLM_PROVIDER = "YAOYAO_LLM_PROVIDER";
