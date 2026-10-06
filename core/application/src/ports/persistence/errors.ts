/**
 * Persistence error contract — declared in @yaoyao/application so use cases
 * and (later) HTTP translation can depend on stable variants without
 * importing infrastructure.
 *
 * These describe *storage* failures only. Domain invariant violations keep
 * their own DomainError types; mappers wrap them with row context but
 * preserve the cause.
 */

export class PersistenceError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.cause = cause;
  }
}

/** A row expected in the caller's owner scope was not found (or is hidden by isolation). */
export class EntityNotFoundError extends PersistenceError {
  constructor(entity: string, detail?: string) {
    super(
      "ENTITY_NOT_FOUND",
      detail ?? `${entity} not found in the current owner scope`,
    );
    this.name = "EntityNotFoundError";
  }
}

/** A uniqueness constraint rejected the write (duplicate owner, key, or intent). */
export class DuplicateEntityError extends PersistenceError {
  readonly constraint?: string;

  constructor(entity: string, constraint?: string) {
    super("DUPLICATE_ENTITY", `${entity} already exists`, undefined);
    this.name = "DuplicateEntityError";
    this.constraint = constraint;
  }
}

/**
 * Optimistic-concurrency loss. The caller must reload and recompute —
 * never blind-overwrite. (Application maps this to HTTP 409 in Phase 4.)
 */
export class StaleWriteError extends PersistenceError {
  readonly expected: number;
  readonly current: number;

  constructor(entity: string, expected: number, current: number) {
    super(
      "STALE_WRITE",
      `${entity} changed underneath the write (expected version ${expected}, current ${current})`,
    );
    this.name = "StaleWriteError";
    this.expected = expected;
    this.current = current;
  }
}

/**
 * A persisted row could not be hydrated into a valid Domain entity.
 * The row is never repaired or defaulted — the failure is explicit and
 * the original Domain error (when present) is preserved as cause.
 */
export class PersistenceMappingError extends PersistenceError {
  readonly table: string;

  constructor(table: string, message: string, cause?: unknown) {
    super("PERSISTENCE_MAPPING", `${table}: ${message}`, cause);
    this.name = "PersistenceMappingError";
    this.table = table;
  }
}

/** A storage-level conflict that is not a plain duplicate (e.g. event sequence race). */
export class PersistenceConflictError extends PersistenceError {
  constructor(message: string, cause?: unknown) {
    super("PERSISTENCE_CONFLICT", message, cause);
    this.name = "PersistenceConflictError";
  }
}

/** The same idempotency key was reused with a different request body. */
export class IdempotencyKeyReusedError extends PersistenceError {
  constructor(operation: string) {
    super(
      "IDEMPOTENCY_KEY_REUSED",
      `idempotency key for ${operation} was already used with a different request`,
    );
    this.name = "IdempotencyKeyReusedError";
  }
}

/** A checksum mismatch on an already-applied migration — hard deployment failure. */
export class MigrationChecksumMismatchError extends PersistenceError {
  readonly version: string;

  constructor(version: string) {
    super(
      "MIGRATION_CHECKSUM_MISMATCH",
      `applied migration ${version} no longer matches its recorded checksum; refusing to continue`,
    );
    this.name = "MigrationChecksumMismatchError";
    this.version = version;
  }
}
