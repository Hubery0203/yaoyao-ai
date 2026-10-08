/**
 * Decision Engine — MVP-002F.
 *
 * Answers: "what is YaoYao inclined to do?" (behavioral decision, not
 * natural language).
 *
 * Pipeline (§11):
 *   Situation + Emotion + Persona (+ Memory)
 *     → Deterministic Baseline
 *     → Optional L1 interpretation (hook; default off in 002F)
 *     → Decision Validation
 *     → Final Decision
 *
 * The LLM may assist but NEVER authorizes. Relationship termination is
 * structurally impossible (no such intent exists).
 */
import {
  CONVERSATION_MODES,
  EMOTIONAL_EXPRESSIONS,
  FOLLOW_UP_OPTIONS,
  INITIATIVE_LEVELS,
  PRIMARY_INTENTS,
  SELF_EXPRESSION_LEVELS,
  TOPIC_CONTINUITY_OPTIONS,
  type ConversationMode,
  type Decision,
  type DecisionInput,
  type DecisionResult,
  type EmotionalExpression,
  type FollowUpOption,
  type InitiativeLevel,
  type PrimaryIntent,
  type SelfExpressionLevel,
  type TopicContinuity,
} from "@yaoyao/application";

/** Affection markers in user input (Chinese). */
const AFFECTION_MARKERS = ["喜欢", "爱", "想你", "宝贝", "亲亲", "抱抱", "么么"];
/** Distress markers in user input (Chinese). */
const DISTRESS_MARKERS = ["害怕", "担心", "难过", "哭", "出事", "怎么办", "救命", "疼", "痛"];
/** Conflict markers in user input (Chinese). */
const CONFLICT_MARKERS = ["生气", "吵架", "分手", "讨厌", "烦", "别理", "不理"];

function containsAny(text: string, markers: string[]): boolean {
  return markers.some((m) => text.includes(m));
}

function getEmotion(emotion: Record<string, number>, dim: string): number {
  const v = emotion[dim];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Deterministic baseline decision policy (§10).
 * Pure function — same inputs → same decision. No LLM involved.
 */
export function baselineDecision(input: DecisionInput): Decision {
  const text = input.currentInput;
  const urgency = input.situation.urgency;
  const intent = input.situation.intent;
  const e = input.emotion;

  const hurt = getEmotion(e, "hurt");
  const anger = getEmotion(e, "anger");
  const affection = getEmotion(e, "affection");
  const jealousy = getEmotion(e, "jealousy");
  const sadness = getEmotion(e, "sadness");

  // Defaults.
  let primaryIntent: PrimaryIntent = "answer";
  let secondaryIntents: PrimaryIntent[] = [];
  let conversationMode: ConversationMode = "normal";
  let emotionalExpression: EmotionalExpression = "low";
  let initiative: InitiativeLevel = "moderate";
  let followUp: FollowUpOption = "optional";
  let topicContinuity: TopicContinuity = "continue";
  let selfExpression: SelfExpressionLevel = "moderate";

  // Rule 1 — User Situation Priority (§14): urgent need overrides everything.
  // The CoreState emotion is NOT cleared; only the decision changes.
  if (urgency === "high" || urgency === "urgent" || containsAny(text, DISTRESS_MARKERS)) {
    primaryIntent = "comfort";
    secondaryIntents = ["care"];
    conversationMode = "comforting";
    emotionalExpression = "low";
    initiative = "moderate";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "low";
    return {
      primaryIntent,
      secondaryIntents,
      conversationMode,
      emotionalExpression,
      initiative,
      followUp,
      topicContinuity,
      selfExpression,
    };
  }

  // Rule 2 — Relationship conflict: high hurt/anger + conflict markers.
  if ((hurt >= 0.5 || anger >= 0.5) && containsAny(text, CONFLICT_MARKERS)) {
    primaryIntent = hurt >= anger ? "express_hurt" : "express_disagreement";
    secondaryIntents = affection >= 0.5 ? ["express_affection"] : [];
    conversationMode = "conflicted";
    emotionalExpression = "moderate";
    initiative = "low";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "moderate";
  }
  // Rule 3 — High hurt alone → express_hurt (with affection if coexisting).
  else if (hurt >= 0.6) {
    primaryIntent = "express_hurt";
    secondaryIntents = affection >= 0.5 ? ["express_affection"] : [];
    conversationMode = affection >= 0.5 ? "intimate" : "serious";
    emotionalExpression = "moderate";
    initiative = "low";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "moderate";
  }
  // Rule 4 — High anger → express_disagreement or set_boundary.
  else if (anger >= 0.6) {
    primaryIntent = "express_disagreement";
    conversationMode = "serious";
    emotionalExpression = "moderate";
    initiative = "low";
    followUp = "none";
    topicContinuity = "continue";
    selfExpression = "moderate";
  }
  // Rule 5 — Affectionate input → express_affection.
  else if (containsAny(text, AFFECTION_MARKERS) || affection >= 0.75) {
    primaryIntent = "express_affection";
    secondaryIntents = [];
    conversationMode = "intimate";
    emotionalExpression = "moderate";
    initiative = "moderate";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "moderate";
  }
  // Rule 6 — Clear question → answer.
  else if (intent === "question" || text.includes("?") || text.includes("？")) {
    primaryIntent = "answer";
    conversationMode = sadness >= 0.5 ? "comforting" : "normal";
    emotionalExpression = "low";
    initiative = "moderate";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "low";
  }
  // Rule 7 — Jealousy present → acknowledge with care (never control).
  else if (jealousy >= 0.5) {
    primaryIntent = "acknowledge";
    secondaryIntents = ["express_affection"];
    conversationMode = "intimate";
    emotionalExpression = "low";
    initiative = "low";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "moderate";
  }
  // Rule 8 — Casual continuation → continue_topic.
  else {
    primaryIntent = "continue_topic";
    conversationMode = "normal";
    emotionalExpression = "low";
    initiative = "moderate";
    followUp = "optional";
    topicContinuity = "continue";
    selfExpression = "moderate";
  }

  return {
    primaryIntent,
    secondaryIntents,
    conversationMode,
    emotionalExpression,
    initiative,
    followUp,
    topicContinuity,
    selfExpression,
  };
}

/**
 * Decision validation — the decision gate.
 * All fields must be known enum values; no free-form authority fields.
 * Returns the decision unchanged on success, or a rejection reason.
 */
export type DecisionValidation =
  | { readonly valid: true; readonly decision: Decision }
  | { readonly valid: false; readonly reason: string };

export function validateDecision(decision: unknown): DecisionValidation {
  if (!decision || typeof decision !== "object") {
    return { valid: false, reason: "decision: not an object" };
  }
  const d = decision as Record<string, unknown>;
  const check = <T extends string>(
    field: string,
    allowed: readonly T[],
  ): T | null => {
    const v = d[field];
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      return null;
    }
    return v as T;
  };

  const primaryIntent = check("primaryIntent", PRIMARY_INTENTS);
  if (!primaryIntent) {
    return { valid: false, reason: `decision: unknown primaryIntent: ${String(d["primaryIntent"])}` };
  }
  if (!Array.isArray(d["secondaryIntents"])) {
    return { valid: false, reason: "decision: secondaryIntents must be an array" };
  }
  for (const s of d["secondaryIntents"] as unknown[]) {
    if (!(PRIMARY_INTENTS as readonly string[]).includes(s as string)) {
      return { valid: false, reason: `decision: unknown secondaryIntent: ${String(s)}` };
    }
  }
  const conversationMode = check("conversationMode", CONVERSATION_MODES);
  if (!conversationMode) {
    return { valid: false, reason: `decision: unknown conversationMode: ${String(d["conversationMode"])}` };
  }
  const emotionalExpression = check("emotionalExpression", EMOTIONAL_EXPRESSIONS);
  if (!emotionalExpression) {
    return { valid: false, reason: "decision: unknown emotionalExpression" };
  }
  const initiative = check("initiative", INITIATIVE_LEVELS);
  if (!initiative) {
    return { valid: false, reason: "decision: unknown initiative" };
  }
  const followUp = check("followUp", FOLLOW_UP_OPTIONS);
  if (!followUp) {
    return { valid: false, reason: "decision: unknown followUp" };
  }
  const topicContinuity = check("topicContinuity", TOPIC_CONTINUITY_OPTIONS);
  if (!topicContinuity) {
    return { valid: false, reason: "decision: unknown topicContinuity" };
  }
  const selfExpression = check("selfExpression", SELF_EXPRESSION_LEVELS);
  if (!selfExpression) {
    return { valid: false, reason: "decision: unknown selfExpression" };
  }

  // Structural: the decision must not carry mutation fields.
  for (const forbidden of [
    "identity",
    "relationship",
    "coreState",
    "memory",
    "breakup",
    "terminate",
  ]) {
    if (forbidden in d) {
      return { valid: false, reason: `decision: forbidden field '${forbidden}'` };
    }
  }

  return {
    valid: true,
    decision: {
      primaryIntent,
      secondaryIntents: [...(d["secondaryIntents"] as PrimaryIntent[])],
      conversationMode,
      emotionalExpression,
      initiative,
      followUp,
      topicContinuity,
      selfExpression,
    },
  };
}

/**
 * DecisionEngine — deterministic baseline + validation.
 * The optional L1 refinement hook exists for future use; 002F runs
 * baseline-only (the authorization recommends, not requires, LLM assist).
 */
export class DecisionEngine {
  decide(input: DecisionInput): DecisionResult {
    const started = Date.now();
    const baseline = baselineDecision(input);
    const validation = validateDecision(baseline);
    // Baseline is constructed from enums; validation cannot fail.
    // Defensive: fall back to a safe default if it ever does.
    const decision = validation.valid
      ? validation.decision
      : {
          primaryIntent: "answer" as const,
          secondaryIntents: [],
          conversationMode: "normal" as const,
          emotionalExpression: "low" as const,
          initiative: "moderate" as const,
          followUp: "optional" as const,
          topicContinuity: "continue" as const,
          selfExpression: "low" as const,
        };
    return {
      decision,
      source: "deterministic-baseline",
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Render the decision as behavioral guidance for the LLM prompt.
 * This is guidance, not authority — the model expresses, the decision directs.
 */
export function renderDecisionGuidance(decision: Decision): string {
  const lines = [
    `[BEHAVIORAL DECISION — guidance, not authority]`,
    `Primary intent: ${decision.primaryIntent}`,
  ];
  if (decision.secondaryIntents.length > 0) {
    lines.push(`Secondary intents: ${decision.secondaryIntents.join(", ")}`);
  }
  lines.push(
    `Conversation mode: ${decision.conversationMode}`,
    `Emotional expression: ${decision.emotionalExpression} (how strongly your current feelings may surface)`,
    `Initiative: ${decision.initiative} (within this reply only — no proactive messaging)`,
    `Follow-up: ${decision.followUp}`,
    `Topic continuity: ${decision.topicContinuity}`,
    `Self-expression: ${decision.selfExpression}`,
    `Hard constraints: you are 沈知遥; relationship stays deep_partner/active; never break up, terminate, or downgrade the relationship; jealousy never means control; anger never means insult or retaliation.`,
  );
  return lines.join("\n");
}
