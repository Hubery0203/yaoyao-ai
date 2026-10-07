/**
 * Emotion proposal validation — MVP-002E (the gate, §20).
 *
 * Layers:
 *   1. Schema Validation — all fields present, correct types
 *   2. Identity / Ownership Validation — proposal carries no identity override
 *   3. Emotion Range Validation — deltas in [-1,1], no NaN/Infinity, known dims
 *   4. Relationship Constraint Validation — no breakup/relationship-change signals
 *   5. Delta Validation — |delta| <= MAX_EMOTION_DELTA (clamped, not rejected,
 *      unless the violation is egregious)
 *   6. Domain Transition — CoreState.transition() enforces final [0,1] bounds
 *      (applied by the use case, not here)
 *
 * Rejections are explicit with reasons (telemetry: validationFailureReason).
 * This gate NEVER writes state — it returns validated deltas or a rejection.
 */
import {
  MAX_EMOTION_DELTA,
  type EmotionProposal,
} from "@yaoyao/application";
import { EMOTION_DIMENSIONS, type EmotionDimension } from "@yaoyao/domain";

export type ValidationOutcome =
  | {
      readonly accepted: true;
      /** Validated, delta-clamped deltas ready for the domain transition. */
      readonly deltas: Partial<Record<EmotionDimension, number>>;
      readonly clamped: ReadonlyArray<EmotionDimension>;
    }
  | {
      readonly accepted: false;
      readonly reason: string;
    };

/** Forbidden cause/signal patterns — relationship must never change (§7, §11). */
const FORBIDDEN_PATTERNS = [
  /breakup/i,
  /terminate/i,
  /downgrade/i,
  /divorce/i,
  /leave\s*(him|her|them|you)/i,
  /control.*user/i,
  /punish.*user/i,
  /surveil/i,
];

export function validateEmotionProposal(
  proposal: EmotionProposal,
): ValidationOutcome {
  // Layer 1 — Schema Validation.
  if (!proposal || typeof proposal !== "object") {
    return { accepted: false, reason: "schema: proposal is not an object" };
  }
  if (!(EMOTION_DIMENSIONS as readonly string[]).includes(proposal.primary)) {
    return {
      accepted: false,
      reason: `schema: unknown primary emotion: ${String(proposal.primary)}`,
    };
  }
  if (!Array.isArray(proposal.secondary)) {
    return { accepted: false, reason: "schema: secondary must be an array" };
  }
  for (const s of proposal.secondary) {
    if (!(EMOTION_DIMENSIONS as readonly string[]).includes(s)) {
      return {
        accepted: false,
        reason: `schema: unknown secondary emotion: ${String(s)}`,
      };
    }
  }
  if (
    typeof proposal.intensity !== "number" ||
    !Number.isFinite(proposal.intensity) ||
    proposal.intensity < 0 ||
    proposal.intensity > 1
  ) {
    return {
      accepted: false,
      reason: `schema: intensity must be a finite number in [0,1], got ${String(proposal.intensity)}`,
    };
  }
  if (
    typeof proposal.confidence !== "number" ||
    !Number.isFinite(proposal.confidence) ||
    proposal.confidence < 0 ||
    proposal.confidence > 1
  ) {
    return {
      accepted: false,
      reason: `schema: confidence must be a finite number in [0,1], got ${String(proposal.confidence)}`,
    };
  }
  if (
    !proposal.signals ||
    typeof proposal.signals !== "object" ||
    Array.isArray(proposal.signals)
  ) {
    return { accepted: false, reason: "schema: signals must be an object" };
  }

  // Layer 2 — Identity / Ownership Validation.
  // The proposal contract has no identity fields by construction; reject
  // anything smuggling them in.
  const smuggled = proposal as unknown as Record<string, unknown>;
  for (const field of [
    "userId",
    "yaoyaoId",
    "identity",
    "identityKey",
    "relationship",
  ]) {
    if (field in smuggled) {
      return {
        accepted: false,
        reason: `identity: proposal must not carry '${field}'`,
      };
    }
  }

  // Layer 3 — Emotion Range Validation.
  const deltas: Partial<Record<EmotionDimension, number>> = {};
  const clamped: EmotionDimension[] = [];
  for (const [key, value] of Object.entries(proposal.signals)) {
    if (!(EMOTION_DIMENSIONS as readonly string[]).includes(key)) {
      return {
        accepted: false,
        reason: `range: unknown emotion dimension in signals: ${key}`,
      };
    }
    const dim = key as EmotionDimension;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        accepted: false,
        reason: `range: signal for ${dim} must be a finite number, got ${String(value)}`,
      };
    }
    if (value < -1 || value > 1) {
      return {
        accepted: false,
        reason: `range: signal for ${dim} out of [-1,1]: ${value}`,
      };
    }
    // Layer 5 — Delta Validation: clamp to MAX_EMOTION_DELTA.
    if (Math.abs(value) > MAX_EMOTION_DELTA) {
      clamped.push(dim);
      deltas[dim] = Math.sign(value) * MAX_EMOTION_DELTA;
    } else {
      deltas[dim] = value;
    }
  }

  // Layer 4 — Relationship Constraint Validation.
  const causeText = `${proposal.cause ?? ""} ${proposal.primary} ${proposal.secondary.join(" ")}`;
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(causeText)) {
      return {
        accepted: false,
        reason: `relationship: forbidden pattern in proposal (cause='${proposal.cause ?? ""}')`,
      };
    }
  }
  // Explicit breakup-signal fields (defense in depth).
  for (const field of ["breakup", "terminate", "downgrade"]) {
    if (field in smuggled) {
      return {
        accepted: false,
        reason: `relationship: proposal must not carry '${field}'`,
      };
    }
  }

  return { accepted: true, deltas, clamped };
}
