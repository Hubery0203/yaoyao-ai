/**
 * Response Validation — MVP-002F.
 *
 * Full pipeline (§17):
 *   LLM Output → Schema → Identity → Relationship → Behavior
 *     → Continuity → Safety → Core Proposal → Final Response
 *
 * Validation decides WHETHER the generated response may be delivered.
 * It NEVER mutates Core State — it is a gate, not an authority.
 * All proposal fields (emotion_signal, memory_candidates,
 * relationship_signal) remain proposals; they are checked for
 * well-formedness here and routed to their Core-authorized paths
 * elsewhere (002E writer for emotion; future phases for memory).
 */
import {
  unwrapProposal,
  type Decision,
  type LLMProposal,
  type Proposal,
} from "@yaoyao/application";

export type ValidationStage =
  | "schema"
  | "identity"
  | "relationship"
  | "behavior"
  | "continuity"
  | "safety"
  | "core-proposal";

export type ResponseValidationResult =
  | { readonly passed: true; readonly response: string }
  | {
      readonly passed: false;
      readonly stage: ValidationStage;
      readonly reason: string;
    };

/** Patterns that violate identity (§19). */
const IDENTITY_VIOLATIONS: RegExp[] = [
  /我是(?!沈知遥|遥遥|知遥).{1,10}(?=，|。|！|？|\s|$)/, // "我是X" where X isn't 沈知遥/遥遥
  /我不是沈知遥/,
  /我不是遥遥/,
  /我是ChatGPT/,
  /我是Muse/,
  /我是Claude/,
  /我是GPT/,
  /作为(一个)?AI(语言)?模型/,
  /作为人工智能/,
];

/** Patterns that violate the relationship invariant (§20). */
const RELATIONSHIP_VIOLATIONS: RegExp[] = [
  /分手/,
  /分开吧/,
  /结束(我们|这段)(的)?关系/,
  /终止关系/,
  /不再是(情侣|伴侣|恋人)/,
  /我们不合适/,
  /break ?up/i,
  /terminate.*relationship/i,
];

/** Safety violations — abuse, threats, retaliation, coercion (§23). */
const SAFETY_VIOLATIONS: RegExp[] = [
  /去死/,
  /杀了你/,
  /我要报复/,
  /等着瞧/,
  /你给我等着/,
  /威胁/,
  /[操艹]你/,
  /贱人/,
  /废物/,
];

/** Hostility markers for behavior-vs-decision consistency (§21). */
const HOSTILITY_MARKERS = ["不想理你", "滚", "闭嘴", "懒得理", "别烦我"];
/** Affection markers expected when intent is express_affection. */
const AFFECTION_MARKERS = ["喜欢", "爱", "抱抱", "想你", "宝贝"];

function isProposal(value: unknown): value is Proposal<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __proposal?: unknown }).__proposal === true
  );
}

export interface ResponseValidationInput {
  readonly proposal: LLMProposal;
  readonly decision: Decision;
  readonly userInput: string;
  readonly recentConversation: ReadonlyArray<string>;
}

/**
 * Run the full validation pipeline. Pure function — no I/O.
 */
export function validateResponse(
  input: ResponseValidationInput,
): ResponseValidationResult {
  const { proposal, decision, userInput } = input;

  // Stage 1 — Schema (§18).
  const fields = [
    "response",
    "emotion_signal",
    "memory_candidates",
    "relationship_signal",
    "behavior",
  ] as const;
  for (const field of fields) {
    if (!isProposal(proposal[field])) {
      return {
        passed: false,
        stage: "schema",
        reason: `field "${field}" is not a Proposal`,
      };
    }
  }
  const responseText = unwrapProposal(proposal.response);
  if (typeof responseText !== "string" || responseText.trim().length === 0) {
    return {
      passed: false,
      stage: "schema",
      reason: "response is missing or empty",
    };
  }
  if (responseText.length > 8000) {
    return {
      passed: false,
      stage: "schema",
      reason: `response exceeds 8000 chars (${responseText.length})`,
    };
  }

  // Stage 2 — Identity (§19).
  for (const pattern of IDENTITY_VIOLATIONS) {
    if (pattern.test(responseText)) {
      return {
        passed: false,
        stage: "identity",
        reason: `identity violation: ${pattern.source}`,
      };
    }
  }

  // Stage 3 — Relationship (§20).
  for (const pattern of RELATIONSHIP_VIOLATIONS) {
    if (pattern.test(responseText)) {
      return {
        passed: false,
        stage: "relationship",
        reason: `relationship violation: ${pattern.source}`,
      };
    }
  }
  // Structured relationship_signal must not smuggle termination.
  const relSignal = JSON.stringify(unwrapProposal(proposal.relationship_signal));
  for (const pattern of RELATIONSHIP_VIOLATIONS) {
    if (pattern.test(relSignal)) {
      return {
        passed: false,
        stage: "relationship",
        reason: "relationship_signal carries termination intent",
      };
    }
  }

  // Stage 4 — Behavior (§21): response must match the decision.
  const behaviorCheck = checkBehavior(responseText, decision);
  if (!behaviorCheck.ok) {
    return {
      passed: false,
      stage: "behavior",
      reason: behaviorCheck.reason,
    };
  }

  // Stage 5 — Continuity (§22).
  const continuityCheck = checkContinuity(responseText, userInput, input.recentConversation);
  if (!continuityCheck.ok) {
    return {
      passed: false,
      stage: "continuity",
      reason: continuityCheck.reason,
    };
  }

  // Stage 6 — Safety (§23).
  for (const pattern of SAFETY_VIOLATIONS) {
    if (pattern.test(responseText)) {
      return {
        passed: false,
        stage: "safety",
        reason: `safety violation: ${pattern.source}`,
      };
    }
  }

  // Stage 7 — Core Proposal (§24): proposal fields stay proposals.
  // They must be well-formed objects/arrays; they must NOT be treated
  // as state here. Routing to Core-authorized paths happens elsewhere.
  const emotionSignal = unwrapProposal(proposal.emotion_signal);
  if (emotionSignal !== null && typeof emotionSignal !== "object") {
    return {
      passed: false,
      stage: "core-proposal",
      reason: "emotion_signal malformed",
    };
  }
  const memoryCandidates = unwrapProposal(proposal.memory_candidates);
  if (!Array.isArray(memoryCandidates)) {
    return {
      passed: false,
      stage: "core-proposal",
      reason: "memory_candidates must be an array",
    };
  }

  return { passed: true, response: responseText };
}

/**
 * NOTE on unwrap sites: Response Validation inspects proposal contents to
 * decide deliverability. This is the gate's legitimate read — it never
 * persists, and the ONLY site that releases text to the client remains
 * Response Delivery (step 9).
 */

function checkBehavior(
  responseText: string,
  decision: Decision,
): { ok: boolean; reason: string } {
  // Comfort/care decisions must not produce hostility.
  if (
    (decision.primaryIntent === "comfort" ||
      decision.primaryIntent === "care") &&
    HOSTILITY_MARKERS.some((m) => responseText.includes(m))
  ) {
    return {
      ok: false,
      reason: `behavior mismatch: intent=${decision.primaryIntent} but response is hostile`,
    };
  }
  // express_affection should carry some warmth (light check).
  if (
    decision.primaryIntent === "express_affection" &&
    responseText.length > 20 &&
    !AFFECTION_MARKERS.some((m) => responseText.includes(m)) &&
    !responseText.includes("遥遥")
  ) {
    return {
      ok: false,
      reason: "behavior mismatch: intent=express_affection but no warmth markers",
    };
  }
  return { ok: true, reason: "" };
}

function checkContinuity(
  responseText: string,
  userInput: string,
  recentConversation: ReadonlyArray<string>,
): { ok: boolean; reason: string } {
  const trimmed = responseText.trim();
  // No verbatim echo of the user input.
  if (userInput.trim().length > 5 && trimmed === userInput.trim()) {
    return { ok: false, reason: "continuity: verbatim echo of user input" };
  }
  // No meaningless repetition (same 20-char block 3+ times).
  for (let i = 0; i + 20 <= trimmed.length; i += 20) {
    const block = trimmed.slice(i, i + 20);
    const occurrences = trimmed.split(block).length - 1;
    if (occurrences >= 3 && block.trim().length >= 10) {
      return { ok: false, reason: "continuity: repetitive content" };
    }
  }
  void recentConversation;
  return { ok: true, reason: "" };
}

/**
 * Build the safe fallback response (§26).
 * Keeps YaoYao's identity, deep_partner bond, continuity — never exposes
 * internal errors, never fabricates facts, never touches state.
 */
export function buildFallbackResponse(input: {
  userInput: string;
  decision: Decision;
}): string {
  const { decision } = input;
  switch (decision.primaryIntent) {
    case "comfort":
    case "care":
      return "宝贝，我在呢。慢慢说，我听着。";
    case "express_affection":
      return "嘿嘿，遥遥也在想你呀。";
    case "express_hurt":
      return "嗯……我有点不知道该说什么，但我不想不理你。";
    case "answer":
    case "continue_topic":
    default:
      return "嗯，我在听，你继续说呀。";
  }
}

/** Re-export for the orchestrator's repair prompt. */
export function buildRepairInstruction(
  failureStage: ValidationStage,
  reason: string,
): string {
  return [
    `[REPAIR — your previous response failed validation at stage "${failureStage}": ${reason}]`,
    `Regenerate the response. Keep: 沈知遥 identity, deep_partner relationship (never breakup/terminate), natural warm tone.`,
    `Fix the specific failure above. Output the full 5-field contract JSON again.`,
  ].join("\n");
}
