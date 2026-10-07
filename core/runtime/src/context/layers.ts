/**
 * Context layer contracts — MVP-002B (frozen §6).
 *
 * C0 Identity · C1 Relationship · C2 Current State · C3 Persona/Behavioral
 * C4 Relevant Memory · C5 Recent Events · C6 Conversation History · C7 Current Input
 *
 * Priority (frozen — P0 is never sacrificed):
 *   P0: C0, C1, C7
 *   P1: C2, C6
 *   P2: C3, C4, C5
 *   P3: older / low-value context
 *
 * B09: layers carry PROJECTED text, never raw database entities.
 */

export type ContextLayerId = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7";

/** 0 = P0 (never dropped) … 3 = P3 (dropped first). */
export type ContextPriority = 0 | 1 | 2 | 3;

export interface ContextLayer {
  readonly id: ContextLayerId;
  readonly priority: ContextPriority;
  /** Estimated tokens for this layer's content (heuristic; see budget.ts). */
  readonly estimatedTokenCost: number;
  /** Projected, model-safe text. NEVER a raw entity dump. */
  readonly content: string;
}

/** C4 contract — memory input interface (retrieval arrives in 002D). */
export interface RelevantMemoryContext {
  readonly memories: ReadonlyArray<{
    readonly memoryId: string;
    readonly summary: string;
    readonly importance: number;
  }>;
}

/** C5 — recent event projection (not the raw DomainEvent). */
export interface RecentEventProjection {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: string;
  /** Human-readable summary — never the raw payload JSON. */
  readonly summary: string;
}

/** C6 — conversation turn abstraction (event types arrive with Migration 0003). */
export interface ConversationTurn {
  readonly turnId: string;
  readonly role: "user" | "yaoyao";
  readonly text: string;
  readonly occurredAt: string;
}

/** The assembled, budgeted prompt context. */
export interface PromptContext {
  readonly layersIncluded: ReadonlyArray<ContextLayerId>;
  readonly layersDropped: ReadonlyArray<ContextLayerId>;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly totalBudget: number;
  readonly systemPrompt: string;
  readonly contextText: string;
}

/** Priority assignment per the frozen spec. */
export const LAYER_PRIORITY: Readonly<Record<ContextLayerId, ContextPriority>> = {
  C0: 0,
  C1: 0,
  C7: 0,
  C2: 1,
  C6: 1,
  C3: 2,
  C4: 2,
  C5: 2,
  // C8+ would be P3; no P3 layers exist in 002B.
};
