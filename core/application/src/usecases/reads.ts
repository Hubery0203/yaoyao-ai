/**
 * Read use cases (Phase 4) — client-safe projections of the Core.
 *
 * All reads are owner-scoped: the JWT-derived userId selects the owner
 * scope, and every repository call is an *Owned variant. These use cases
 * return domain entities; the HTTP layer projects them to client-safe
 * shapes (core/api presentation mappers, allowlist approach).
 *
 * Pagination is applied in the use case over the owner-scoped read, so
 * the Phase 3 repository ports stay untouched.
 */
import type {
  CoreState,
  Memory,
  MemoryStatus,
  MemoryType,
  Relationship,
  Session,
  User,
  UserId,
  YaoYaoAggregate,
  YaoYaoId,
} from "@yaoyao/domain";
import type { PersistedEvent } from "../ports/persistence/repositories.js";
import type { PersistenceTransaction } from "../ports/persistence/transactions.js";

export async function getUserProfile(
  tx: PersistenceTransaction,
  input: { userId: UserId },
): Promise<User> {
  return tx.users.findOwned(input.userId);
}

export async function getYaoYaoIdentity(
  tx: PersistenceTransaction,
  input: { userId: UserId },
): Promise<YaoYaoAggregate> {
  return tx.aggregates.loadOwned(input.userId);
}

export async function getCurrentState(
  tx: PersistenceTransaction,
  input: { userId: UserId },
): Promise<CoreState> {
  return tx.states.findOwned(input.userId);
}

export async function getRelationship(
  tx: PersistenceTransaction,
  input: { userId: UserId },
): Promise<Relationship> {
  return tx.relationships.findOwned(input.userId);
}

export interface Pagination {
  limit: number;
  offset: number;
}

export function normalizePagination(input: {
  limit?: number;
  offset?: number;
}): Pagination {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  return { limit, offset };
}

export interface EventPage {
  events: PersistedEvent[];
  total: number;
  limit: number;
  offset: number;
}

export async function listEvents(
  tx: PersistenceTransaction,
  input: { userId: UserId; limit?: number; offset?: number },
): Promise<EventPage> {
  const { limit, offset } = normalizePagination(input);
  // Resolve the YaoYao under the owner scope first (404 when none).
  const aggregate = await tx.aggregates.loadOwned(input.userId);
  const yaoyaoId: YaoYaoId = aggregate.yaoyaoId;
  const all = await tx.events.readOwnedAfter(input.userId, yaoyaoId, 0);
  return {
    events: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset,
  };
}

export interface MemoryPage {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export async function listMemories(
  tx: PersistenceTransaction,
  input: {
    userId: UserId;
    type?: MemoryType;
    status?: MemoryStatus;
    limit?: number;
    offset?: number;
  },
): Promise<MemoryPage> {
  const { limit, offset } = normalizePagination(input);
  const all = await tx.memories.listOwned(input.userId, {
    type: input.type,
    status: input.status,
  });
  return {
    memories: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset,
  };
}

export async function listSessions(
  tx: PersistenceTransaction,
  input: { userId: UserId },
): Promise<Session[]> {
  return tx.sessions.listOwned(input.userId);
}
