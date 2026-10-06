import { DomainValidationError } from "./errors.js";

/** Assert a number is within [0, 1]; used by emotion, metrics, scores. */
export function assertUnitInterval(value: number, name: string): void {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new DomainValidationError(
      `${name} must be a number in [0, 1], got ${String(value)}`,
    );
  }
}

/** Assert every entry of a record is within [0, 1]. */
export function assertAllUnitInterval(
  values: Record<string, number>,
  context: string,
): void {
  for (const [key, value] of Object.entries(values)) {
    assertUnitInterval(value, `${context}.${key}`);
  }
}

export function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainValidationError(`${name} must be a non-empty string`);
  }
}

export function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainValidationError(`${name} must be a valid Date`);
  }
}
