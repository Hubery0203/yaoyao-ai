/**
 * Minimal validation boundary — MVP-002A.
 *
 * The full 7-stage validation pipeline arrives in MVP-002F. This skeleton
 * implements the structural gate that every later stage builds on:
 *
 * - The proposal has all 5 frozen contract fields (§10).
 * - Each field is a Proposal (branded) — not a raw value.
 * - The response text is a non-empty string.
 *
 * On success it returns a ValidatedProposal — still branded, still
 * carrying no persistent authority. The ONLY legal unwrap site is
 * Response Delivery (step 9) for the response text.
 *
 * Validation NEVER decides emotion values, memory persistence, or any
 * domain outcome. It is a gate, not an authority (§I.3 of the proposal).
 */
import {
  asProposal,
  type LLMProposal,
  type Proposal,
} from "@yaoyao/application";

/** A proposal that passed the minimal structural gate. Still branded. */
export type ValidatedProposal = LLMProposal;

export class ProposalValidationError extends Error {
  readonly code = "PROPOSAL_VALIDATION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "ProposalValidationError";
  }
}

function isProposal(value: unknown): value is Proposal<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __proposal?: unknown }).__proposal === true
  );
}

/**
 * Minimal structural validation. Throws ProposalValidationError on failure.
 * Pure function — no I/O, no persistence, no side effects.
 */
export function validateProposalMinimal(proposal: LLMProposal): ValidatedProposal {
  const fields = [
    "response",
    "emotion_signal",
    "memory_candidates",
    "relationship_signal",
    "behavior",
  ] as const;
  for (const field of fields) {
    if (!isProposal(proposal[field])) {
      throw new ProposalValidationError(
        `field "${field}" is not a Proposal — raw model output rejected`,
      );
    }
  }
  if (typeof proposal.response.value !== "string" || proposal.response.value.length === 0) {
    throw new ProposalValidationError("response proposal must be a non-empty string");
  }
  return proposal;
}

/**
 * Re-wrap helper for the orchestrator: marks a validated proposal.
 * (Identity function at runtime; the type documents the gate having passed.)
 */
export function markValidated(proposal: LLMProposal): ValidatedProposal {
  return validateProposalMinimal(proposal);
}

export { asProposal };
