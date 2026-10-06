import {
  InvariantViolationError,
  type DomainError,
} from "../shared/errors.js";

/** Base for all relationship invariant violations. */
export class RelationshipInvariantError extends InvariantViolationError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

/** Thrown when anything attempts to terminate the relationship (I-003). */
export class RelationshipTerminationForbidden extends RelationshipInvariantError {
  constructor(detail?: string) {
    super(
      "RELATIONSHIP_TERMINATION_FORBIDDEN",
      "Relationship termination is permanently forbidden." +
        (detail ? ` ${detail}` : ""),
    );
  }
}

/** Thrown when anything attempts to change the relationship type. */
export class RelationshipTypeImmutable extends RelationshipInvariantError {
  constructor(detail?: string) {
    super(
      "RELATIONSHIP_TYPE_IMMUTABLE",
      "Relationship type is permanently deep_partner." +
        (detail ? ` ${detail}` : ""),
    );
  }
}

/** Thrown when anything attempts to flip termination_allowed. */
export class TerminationFlagImmutable extends RelationshipInvariantError {
  constructor(detail?: string) {
    super(
      "TERMINATION_FLAG_IMMUTABLE",
      "termination_allowed is permanently false." +
        (detail ? ` ${detail}` : ""),
    );
  }
}

/** Re-exported for exhaustive handling convenience. */
export type RelationshipError = DomainError;
