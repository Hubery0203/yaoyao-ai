/**
 * Mapper primitives — driver-value translation shared by all mappers.
 *
 * These convert PostgreSQL driver shapes (numeric-as-string, jsonb, dates)
 * into plain JS values. Semantic validation stays in the domain: every
 * fromRow() ends in a guarded reconstitute()/create() call, whose typed
 * errors propagate with row/table context and are never repaired.
 */
import { PersistenceMappingError } from "@yaoyao/application";

/** Brand a raw string id without validating (domain reconstitute validates). */
export function branded<T>(raw: string, column: string, table: string): T {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new PersistenceMappingError(
      table,
      `column ${column} is not a usable id`,
    );
  }
  return raw as T;
}

/** numeric(p,s) arrives as a string from node-pg; require a finite number. */
export function numericToNumber(
  raw: string,
  column: string,
  table: string,
): number {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) {
    throw new PersistenceMappingError(
      table,
      `column ${column} is not a finite number: ${String(raw)}`,
    );
  }
  return n;
}

/** jsonb must be a plain object for the shapes we persist. */
export function asRecord(
  raw: unknown,
  column: string,
  table: string,
): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PersistenceMappingError(
      table,
      `column ${column} is not a JSON object`,
    );
  }
  return { ...(raw as Record<string, unknown>) };
}

/** Copy a timestamptz value; never trust a non-Date. */
export function asDate(raw: unknown, column: string, table: string): Date {
  const d = raw instanceof Date ? new Date(raw.getTime()) : new Date(NaN);
  if (Number.isNaN(d.getTime())) {
    throw new PersistenceMappingError(
      table,
      `column ${column} is not a valid timestamp`,
    );
  }
  return d;
}

/** Nullable timestamp passthrough. */
export function asNullableDate(
  raw: unknown,
  column: string,
  table: string,
): Date | null {
  if (raw === null || raw === undefined) return null;
  return asDate(raw, column, table);
}

/**
 * Run guarded domain hydration, wrapping any domain rejection with
 * table/row context while preserving the original error as cause.
 */
export function hydrate<T>(
  table: string,
  rowId: string,
  fn: () => T,
): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof PersistenceMappingError) throw err;
    throw new PersistenceMappingError(
      table,
      `row ${rowId} failed guarded hydration`,
      err,
    );
  }
}
