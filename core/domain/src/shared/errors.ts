/**
 * Domain error hierarchy.
 *
 * Invariant violations are thrown as typed errors so tests and future
 * application layers can assert the *reason* for rejection, not just that
 * something failed. Error codes are stable strings for log correlation.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

/** A frozen product/domain rule was violated. Never caught and ignored. */
export class InvariantViolationError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

/** Input failed domain validation (bad shape, out-of-range value, ...). */
export class DomainValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(
      "DOMAIN_VALIDATION_ERROR",
      details === undefined ? message : `${message}: ${JSON.stringify(details)}`,
    );
  }
}
