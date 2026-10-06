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

function asPgError(e: unknown): PgErrorLike | null {
  if (e !== null && typeof e === "object" && "code" in e) {
    return e as PgErrorLike;
  }
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
