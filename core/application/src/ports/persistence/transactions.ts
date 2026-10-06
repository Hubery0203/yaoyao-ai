/**
 * Transaction port — application use cases own transaction scope.
 *
 * The infrastructure implementation (PostgresTransactionManager) opens one
 * database transaction per call, pins the RLS owner context
 * (SET LOCAL app.user_id) to that transaction, hands the use case a bundle
 * of repositories bound to the transaction handle, and commits or rolls
 * back atomically. Repositories never commit independently.
 */
import type { UserId } from "@yaoyao/domain";
import type {
  CoreStateRepository,
  EventStore,
  IdempotencyStore,
  MemoryContainerRepository,
  MemoryRepository,
  OutboxStore,
  RefreshSessionRepository,
  RelationshipRepository,
  SessionRepository,
  UserRepository,
  YaoYaoAggregateRepository,
} from "./repositories.js";

/** All repositories bound to a single transaction handle. */
export interface PersistenceTransaction {
  users: UserRepository;
  aggregates: YaoYaoAggregateRepository;
  relationships: RelationshipRepository;
  states: CoreStateRepository;
  sessions: SessionRepository;
  events: EventStore;
  memoryContainers: MemoryContainerRepository;
  memories: MemoryRepository;
  refreshSessions: RefreshSessionRepository;
  idempotency: IdempotencyStore;
  outbox: OutboxStore;
}

export interface TransactionManager {
  /**
   * Run `fn` inside one transaction scoped to `userId`. The owner context
   * is set transaction-locally, so pooled-connection reuse cannot leak it.
   * Any throw rolls back every write in the transaction.
   */
  runAsUser<T>(
    userId: UserId,
    fn: (tx: PersistenceTransaction) => Promise<T>,
  ): Promise<T>;
}
