/**
 * Persistence ports — intention-revealing storage contracts declared in
 * @yaoyao/application and implemented by @yaoyao/infrastructure/postgres.
 *
 * Every method that touches a private resource takes the authenticated
 * `userId` first; resource IDs are secondary selectors inside that owner
 * scope. Repositories are persistence adapters, not rule owners: they may
 * reject storage conflicts, but they never decide whether a domain
 * transition is allowed.
 */
import type {
  CoreState,
  DomainEvent,
  EventActor,
  EventId,
  EventSource,
  EventType,
  Memory,
  MemoryContainerId,
  MemoryId,
  MemoryStatus,
  MemoryType,
  Relationship,
  Session,
  SessionId,
  User,
  UserId,
  UserStatus,
  YaoYaoAggregate,
  YaoYaoId,
} from "@yaoyao/domain";
import type {
  DuplicateEntityError,
  EntityNotFoundError,
  IdempotencyKeyReusedError,
  PersistenceConflictError,
  PersistenceMappingError,
  StaleWriteError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface UserRepository {
  /** Guarded User hydration; throws EntityNotFoundError outside the scope. */
  findOwned(userId: UserId): Promise<User>;
  /** Insert a new user; throws DuplicateEntityError on email conflict. */
  insert(input: {
    user: User;
    email: string;
    passwordHash: string;
  }): Promise<void>;
  /** Persist status changes (suspend/reactivate). */
  save(
    userId: UserId,
    patch: { status: UserStatus; updatedAt: Date },
  ): Promise<User>;
}

// ---------------------------------------------------------------------------
// YaoYao aggregate (1:1:1 composition)
// ---------------------------------------------------------------------------

export interface YaoYaoAggregateRepository {
  /**
   * Hydrate YaoYao + Relationship + CoreState separately, then compose via
   * YaoYaoAggregate.reconstitute(). Any member failure aborts the load.
   */
  loadOwned(userId: UserId): Promise<YaoYaoAggregate>;
  /** Insert all three members; caller owns the surrounding transaction. */
  insert(aggregate: YaoYaoAggregate): Promise<void>;
}

// ---------------------------------------------------------------------------
// Relationship — no termination/type/status write method exists by design.
// ---------------------------------------------------------------------------

export interface RelationshipRepository {
  findOwned(userId: UserId): Promise<Relationship>;
  /** Persist metric evolution only; hard fields are never written. */
  saveMetrics(
    userId: UserId,
    relationship: Relationship,
  ): Promise<Relationship>;
}

// ---------------------------------------------------------------------------
// CoreState — optimistic compare-and-swap, never blind overwrite.
// ---------------------------------------------------------------------------

export type SaveStateResult =
  | { outcome: "saved"; state: CoreState }
  | { outcome: "stale"; expected: number; current: number };

export interface CoreStateRepository {
  findOwned(userId: UserId): Promise<CoreState>;
  insert(state: CoreState): Promise<void>;
  /**
   * Compare-and-swap: writes only when the stored version still equals
   * `expectedVersion`. Returns the stale outcome (with the live version)
   * instead of throwing, so callers can reload and recompute.
   */
  saveStateIfVersionMatches(
    userId: UserId,
    expectedVersion: number,
    next: CoreState,
  ): Promise<SaveStateResult>;
}

// ---------------------------------------------------------------------------
// Session — independent lifecycle; close never cascades.
// ---------------------------------------------------------------------------

export interface SessionRepository {
  findOwned(userId: UserId, sessionId: SessionId): Promise<Session>;
  insert(session: Session): Promise<void>;
  /** Persist a close; idempotent at the domain level. */
  save(userId: UserId, session: Session): Promise<Session>;
  listOwned(userId: UserId): Promise<Session[]>;
}

// ---------------------------------------------------------------------------
// EventStore — append/read only. No update or delete method exists.
// ---------------------------------------------------------------------------

/** A domain event with its persistence-assigned ordering metadata. */
export interface PersistedEvent {
  event: DomainEvent;
  aggregateSeq: number;
  recordedAt: Date;
  schemaVersion: number;
}

export interface AppendEventInput {
  event: DomainEvent;
  /** Reducer dispatch key with type; defaults to 1. Must be >= 1. */
  schemaVersion?: number;
}

export interface EventStore {
  /**
   * Allocate the next per-YaoYao aggregate_seq under a transaction-scoped
   * advisory lock and insert the immutable event. Throws
   * PersistenceConflictError only if the uniqueness race guard fires.
   */
  append(input: AppendEventInput): Promise<PersistedEvent>;
  /** Ordered replay strictly after the given sequence (exclusive). */
  readOwnedAfter(
    userId: UserId,
    yaoyaoId: YaoYaoId,
    afterSeq: number,
  ): Promise<PersistedEvent[]>;
  /** Events of one session in sequence order. */
  readSession(
    userId: UserId,
    yaoyaoId: YaoYaoId,
    sessionId: SessionId,
  ): Promise<PersistedEvent[]>;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** Storage bookkeeping for the 1:1 memory container (no domain entity). */
export interface MemoryContainer {
  containerId: MemoryContainerId;
  userId: UserId;
  yaoyaoId: YaoYaoId;
  schemaVersion: number;
  createdAt: Date;
}

export interface MemoryContainerRepository {
  findOwned(userId: UserId): Promise<MemoryContainer>;
  insert(input: {
    containerId: MemoryContainerId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    schemaVersion?: number;
  }): Promise<MemoryContainer>;
}

export interface MemoryRepository {
  findOwned(userId: UserId, memoryId: MemoryId): Promise<Memory>;
  insert(memory: Memory): Promise<void>;
  /** Persist a lifecycle transition (validate/consolidate/correct/archive/recall). */
  save(userId: UserId, memory: Memory): Promise<Memory>;
  listOwned(
    userId: UserId,
    filter?: { type?: MemoryType; status?: MemoryStatus },
  ): Promise<Memory[]>;
}

// ---------------------------------------------------------------------------
// Refresh sessions — rotation seam (endpoints land in Phase 4).
// ---------------------------------------------------------------------------

export interface RefreshSessionRecord {
  refreshSessionId: string;
  userId: UserId;
  tokenHash: Buffer;
  tokenFamilyId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  deviceMetadata: Record<string, unknown>;
  createdAt: Date;
}

export interface RefreshSessionRepository {
  insert(input: {
    refreshSessionId?: string;
    userId: UserId;
    tokenHash: Buffer;
    tokenFamilyId: string;
    expiresAt: Date;
    deviceMetadata?: Record<string, unknown>;
  }): Promise<RefreshSessionRecord>;
  findByTokenHash(tokenHash: Buffer): Promise<RefreshSessionRecord | null>;
  /**
   * Atomic rotation under SELECT ... FOR UPDATE: marks the current row
   * rotated and inserts its successor. Throws EntityNotFoundError when the
   * current row is missing, already rotated, or revoked.
   */
  rotate(input: {
    currentTokenHash: Buffer;
    successorTokenHash: Buffer;
    successorExpiresAt: Date;
  }): Promise<RefreshSessionRecord>;
  revoke(userId: UserId, tokenFamilyId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Idempotency — the database record is authoritative.
// ---------------------------------------------------------------------------

export type IdempotencyStatus = "processing" | "completed" | "failed";

export interface IdempotencyRecord {
  userScope: string;
  operation: string;
  keyHash: Buffer;
  requestHash: Buffer;
  status: IdempotencyStatus;
  responseRef: Record<string, unknown> | null;
  expiresAt: Date;
}

export type BeginIdempotencyResult =
  | { outcome: "claimed" }
  | { outcome: "existing"; record: IdempotencyRecord; requestMatches: boolean };

export interface IdempotencyStore {
  /**
   * Atomically claim the (scope, operation, key) slot. The single winner
   * gets "claimed"; losers observe the existing record.
   */
  begin(input: {
    userScope: string;
    operation: string;
    /** Raw Idempotency-Key header value; hashed by the implementation. */
    key: string;
    /** Canonical request body; hashed by the implementation. */
    requestBody: string;
    ttlSeconds?: number;
  }): Promise<BeginIdempotencyResult>;
  complete(input: {
    userScope: string;
    operation: string;
    key: string;
    responseRef: Record<string, unknown>;
  }): Promise<void>;
  fail(input: {
    userScope: string;
    operation: string;
    key: string;
  }): Promise<void>;
  find(input: {
    userScope: string;
    operation: string;
    key: string;
  }): Promise<IdempotencyRecord | null>;
}

// ---------------------------------------------------------------------------
// Outbox — write-only in Phase 3. No relay runs in this phase.
// ---------------------------------------------------------------------------

export interface OutboxIntent {
  outboxId: string;
  eventId: EventId;
  userId: UserId;
  yaoyaoId: YaoYaoId;
  topic: string;
  payloadRef: Record<string, unknown>;
  availableAt: Date;
}

export interface OutboxStore {
  /**
   * Insert one logical delivery intent in the caller's transaction.
   * UNIQUE(event_id, topic) rejects a second intent for the same route.
   */
  enqueueForEvent(input: {
    eventId: EventId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    topic: string;
    payloadRef: Record<string, unknown>;
    availableAt?: Date;
  }): Promise<OutboxIntent>;
  /** Read-only scan for a future relay; unused in Phase 3 runtime. */
  findPending(limit: number): Promise<OutboxIntent[]>;
}

// Re-export error variants next to the ports that raise them.
export type {
  DuplicateEntityError,
  EntityNotFoundError,
  IdempotencyKeyReusedError,
  PersistenceConflictError,
  PersistenceMappingError,
  StaleWriteError,
};

// Event building blocks re-exported for use-case convenience.
export type { EventActor, EventSource, EventType };
