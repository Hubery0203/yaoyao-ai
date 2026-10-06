/**
 * PostgresSessionRepository + PostgresEventStore.
 *
 * Sessions have an independent lifecycle: closing a session never touches
 * the companion graph. The event store is append/read only — there is no
 * update or delete method, and the database independently rejects direct
 * mutation (revoked grants + immutable trigger).
 *
 * Sequence allocation: inside the caller's transaction, a short
 * transaction-scoped advisory lock (deterministic 64-bit key per YaoYao)
 * serializes the append stream; UNIQUE(yaoyao_id, aggregate_seq) is the
 * final race guard.
 */
import {
  EntityNotFoundError,
  PersistenceConflictError,
  type AppendEventInput,
  type EventStore,
  type PersistedEvent,
  type SessionRepository,
} from "@yaoyao/application";
import {
  Session,
  type SessionId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { isUniqueViolation, mapPgError } from "../errors.js";
import { eventSeqLockKey } from "../locks.js";
import {
  fromEventRow,
  fromSessionRow,
  toEventRow,
  toSessionRow,
} from "../mappers/index.js";
import { events, sessions } from "../schema/index.js";

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async findOwned(userId: UserId, sessionId: SessionId): Promise<Session> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId as string),
          eq(sessions.sessionId, sessionId as string),
        ),
      )
      .limit(1);
    if (rows.length === 0) throw new EntityNotFoundError("Session");
    return fromSessionRow(rows[0]);
  }

  async insert(session: Session): Promise<void> {
    try {
      await this.db.insert(sessions).values(toSessionRow(session));
    } catch (e) {
      throw mapPgError(e, "Session");
    }
  }

  async save(userId: UserId, session: Session): Promise<Session> {
    const rows = await this.db
      .update(sessions)
      .set({
        endedAt: session.endedAt,
        status: session.status,
      })
      .where(
        and(
          eq(sessions.userId, userId as string),
          eq(sessions.sessionId, session.sessionId as string),
        ),
      )
      .returning();
    if (rows.length === 0) throw new EntityNotFoundError("Session");
    return fromSessionRow(rows[0]);
  }

  async listOwned(userId: UserId): Promise<Session[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId as string))
      .orderBy(asc(sessions.startedAt));
    return rows.map(fromSessionRow);
  }
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly db: Db) {}

  async append(input: AppendEventInput): Promise<PersistedEvent> {
    const event = input.event;
    const schemaVersion = input.schemaVersion ?? 1;

    // Serialize this companion's append stream for the transaction.
    // The lock is xact-scoped: released automatically at COMMIT/ROLLBACK.
    const lockKey = eventSeqLockKey(event.yaoyaoId as string);
    await this.db.execute(
      sql`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`,
    );

    const [maxRow] = await this.db
      .select({ max: sql<string | null>`COALESCE(MAX(${events.aggregateSeq}), 0)` })
      .from(events)
      .where(eq(events.yaoyaoId, event.yaoyaoId as string));
    const aggregateSeq = Number(maxRow?.max ?? 0) + 1;

    try {
      const [inserted] = await this.db
        .insert(events)
        .values(toEventRow({ event, aggregateSeq, schemaVersion }))
        .returning();
      return fromEventRow(inserted);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new PersistenceConflictError(
          `event sequence race for yaoyao ${event.yaoyaoId}; retry the append`,
          e,
        );
      }
      throw mapPgError(e, "Event");
    }
  }

  async readOwnedAfter(
    userId: UserId,
    yaoyaoId: YaoYaoId,
    afterSeq: number,
  ): Promise<PersistedEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.userId, userId as string),
          eq(events.yaoyaoId, yaoyaoId as string),
          gt(events.aggregateSeq, afterSeq),
        ),
      )
      .orderBy(asc(events.aggregateSeq));
    return rows.map(fromEventRow);
  }

  async readSession(
    userId: UserId,
    yaoyaoId: YaoYaoId,
    sessionId: SessionId,
  ): Promise<PersistedEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          eq(events.userId, userId as string),
          eq(events.yaoyaoId, yaoyaoId as string),
          eq(events.sessionId, sessionId as string),
        ),
      )
      .orderBy(asc(events.aggregateSeq));
    return rows.map(fromEventRow);
  }
}
