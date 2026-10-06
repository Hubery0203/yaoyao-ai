/**
 * PostgreSQL error mapping — driver codes to stable persistence errors.
 *
 * Only storage-level outcomes are mapped here. Domain invariant violations
 * keep their own types and propagate through mappers untouched.
 */
import {
  DuplicateEntityError,
  PersistenceConflictError,
  PersistenceError,
} from "@yaoyao/application";

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

function asPgError(e: unknown, depth = 0): PgErrorLike | null {
  if (e === null || typeof e !== "object" || depth > 5) return null;
  if ("code" in e && typeof (e as { code?: unknown }).code === "string") {
    return e as PgErrorLike;
  }
  // Drizzle wraps driver errors (query/params on the outer error, the pg
  // error with its SQLSTATE `code` nested under `cause`). Unwrap so mapped
  // outcomes (e.g. 23505 -> DuplicateEntityError) survive the wrapper.
  if ("cause" in e) return asPgError((e as { cause?: unknown }).cause, depth + 1);
  return null;
}

/** True for unique-violation (23505) — used for claim-style inserts. */
export function isUniqueViolation(e: unknown): boolean {
  return asPgError(e)?.code === "23505";
}

/**
 * Map a driver/storage throw to a stable PersistenceError variant.
 * Unknown failures become PERSISTENCE_UNKNOWN with the original as cause.
 */
export function mapPgError(e: unknown, entity: string): PersistenceError {
  if (e instanceof PersistenceError) return e;
  const pg = asPgError(e);
  if (pg?.code) {
    const where = pg.constraint ? ` (${pg.constraint})` : "";
    switch (pg.code) {
      case "23505":
        return new DuplicateEntityError(entity, pg.constraint);
      case "23503":
        return new PersistenceConflictError(
          `${entity}: foreign-key violation${where}`,
          e,
        );
      case "23514":
        return new PersistenceConflictError(
          `${entity}: check-constraint violation${where}`,
          e,
        );
      case "55000":
        // Our own trigger ERRCODE (events_immutable) or similar guards.
        return new PersistenceConflictError(
          `${entity}: ${pg.message ?? "write rejected by database guard"}${where}`,
          e,
        );
      default:
        break;
    }
  }
  return new PersistenceError(
    "PERSISTENCE_UNKNOWN",
    `${entity}: storage failure`,
    e,
  );
}
