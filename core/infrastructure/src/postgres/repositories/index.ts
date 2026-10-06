/**
 * Repository barrel — binds every port implementation to one Drizzle
 * handle, producing the PersistenceTransaction bundle a use case runs in.
 */
import type {
  PersistenceTransaction,
  TransactionManager,
} from "@yaoyao/application";
import type { Db } from "../db.js";
import { PostgresIdempotencyStore } from "./idempotency.js";
import {
  PostgresUserRepository,
  PostgresYaoYaoAggregateRepository,
} from "./identity.js";
import { PostgresMemoryContainerRepository, PostgresMemoryRepository } from "./memory.js";
import { PostgresOutboxStore } from "./outbox.js";
import { PostgresRefreshSessionRepository } from "./refresh-sessions.js";
import { PostgresEventStore, PostgresSessionRepository } from "./session-events.js";
import {
  PostgresCoreStateRepository,
  PostgresRelationshipRepository,
} from "./state.js";

export * from "./identity.js";
export * from "./state.js";
export * from "./session-events.js";
export * from "./memory.js";
export * from "./refresh-sessions.js";
export * from "./idempotency.js";
export * from "./outbox.js";

/** Assemble all repositories against a single transaction handle. */
export function createRepositories(db: Db): PersistenceTransaction {
  return {
    users: new PostgresUserRepository(db),
    aggregates: new PostgresYaoYaoAggregateRepository(db),
    relationships: new PostgresRelationshipRepository(db),
    states: new PostgresCoreStateRepository(db),
    sessions: new PostgresSessionRepository(db),
    events: new PostgresEventStore(db),
    memoryContainers: new PostgresMemoryContainerRepository(db),
    memories: new PostgresMemoryRepository(db),
    refreshSessions: new PostgresRefreshSessionRepository(db),
    idempotency: new PostgresIdempotencyStore(db),
    outbox: new PostgresOutboxStore(db),
  };
}

export type { TransactionManager };
