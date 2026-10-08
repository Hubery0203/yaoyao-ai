/**
 * Decision contract — MVP-002F Decision + Response Validation.
 *
 * Decision ≠ Response. The Decision Engine answers "what is YaoYao
 * inclined to do"; the LLM decides "how she expresses it"; Response
 * Validation decides "whether it may be delivered".
 *
 * ALL fields are enum/constrained. The Decision carries NO authority
 * over identity, relationship, core state, or memory — it is behavioral
 * guidance only.
 */

/** Frozen primary intents (§5). Do not change semantics without PM. */
export const PRIMARY_INTENTS = [
  "answer",
  "comfort",
  "care",
  "express_affection",
  "playful",
  "continue_topic",
  "ask_followup",
  "share",
  "acknowledge",
  "repair",
  "express_hurt",
  "express_disagreement",
  "set_boundary",
] as const;
export type PrimaryIntent = (typeof PRIMARY_INTENTS)[number];

/** Frozen conversation modes (§6). Mode never changes relationship type. */
export const CONVERSATION_MODES = [
  "normal",
  "intimate",
  "comforting",
  "playful",
  "serious",
  "conflicted",
  "reconnecting",
  "reflective",
] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** How strongly the current emotion may surface in the response. */
export const EMOTIONAL_EXPRESSIONS = ["none", "low", "moderate", "high"] as const;
export type EmotionalExpression = (typeof EMOTIONAL_EXPRESSIONS)[number];

/** Initiative within THIS reply only (§7). Not proactive messaging. */
export const INITIATIVE_LEVELS = ["none", "low", "moderate", "high"] as const;
export type InitiativeLevel = (typeof INITIATIVE_LEVELS)[number];

/** Whether the reply should invite/require a follow-up. */
export const FOLLOW_UP_OPTIONS = ["required", "optional", "none"] as const;
export type FollowUpOption = (typeof FOLLOW_UP_OPTIONS)[number];

/** Topic handling for this turn (§9). */
export const TOPIC_CONTINUITY_OPTIONS = ["continue", "shift", "open"] as const;
export type TopicContinuity = (typeof TOPIC_CONTINUITY_OPTIONS)[number];

/** How much YaoYao expresses herself (vs. focusing on the user). */
export const SELF_EXPRESSION_LEVELS = ["none", "low", "moderate", "high"] as const;
export type SelfExpressionLevel = (typeof SELF_EXPRESSION_LEVELS)[number];

/**
 * Decision — the full behavioral contract (§12).
 * No free-form authority fields. No identity/relationship/state/memory
 * mutation capability, structurally.
 */
export interface Decision {
  readonly primaryIntent: PrimaryIntent;
  readonly secondaryIntents: ReadonlyArray<PrimaryIntent>;
  readonly conversationMode: ConversationMode;
  readonly emotionalExpression: EmotionalExpression;
  readonly initiative: InitiativeLevel;
  readonly followUp: FollowUpOption;
  readonly topicContinuity: TopicContinuity;
  readonly selfExpression: SelfExpressionLevel;
}

/**
 * Input to the Decision Engine: Context + Emotion + Persona (§4).
 * The engine consumes Situation Understanding output; it does not
 * reimplement situation analysis.
 */
export interface DecisionInput {
  readonly userId: string;
  readonly yaoyaoId: string;
  readonly currentInput: string;
  readonly situation: {
    readonly intent: string;
    readonly urgency: string;
    readonly taskNature: string;
  };
  readonly emotion: Record<string, number>;
  readonly personaTone: string;
  readonly recentConversation: ReadonlyArray<string>;
  readonly traceId: string;
}

export type DecisionSource = "deterministic-baseline" | "llm-refined";

/** Result of the decision pipeline: the validated decision + its source. */
export interface DecisionResult {
  readonly decision: Decision;
  readonly source: DecisionSource;
  readonly latencyMs: number;
}
