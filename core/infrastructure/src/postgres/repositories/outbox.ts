/**
 * PostgresOutboxStore — write-only in Phase 3.
 *
 * One logical delivery intent per (event_id, topic), enforced by a UNIQUE
 * constraint: duplicate side effects are impossible by construction.
 * No relay runs in this phase; findPending() exists for the future relay
 * and for test assertions.
 */
import {
  type OutboxIntent,
  type OutboxStore,
} from "@yaoyao/application";
import { uuidv7, type EventId, type UserId, type YaoYaoId } from "@yaoyao/domain";
import { asc, isNull } from "drizzle-orm";
import type { Db } from "../db.js";
import { mapPgError } from "../errors.js";
import { fromOutboxRow, toOutboxRow } from "../mappers/index.js";
import { outbox } from "../schema/index.js";

export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly db: Db) {}

  async enqueueForEvent(input: {
    eventId: EventId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    topic: string;
    payloadRef: Record<string, unknown>;
    availableAt?: Date;
  }): Promise<OutboxIntent> {
    try {
      const [row] = await this.db
        .insert(outbox)
        .values(
          toOutboxRow({
            outboxId: uuidv7(),
            eventId: input.eventId,
            userId: input.userId,
            yaoyaoId: input.yaoyaoId,
            topic: input.topic,
            payloadRef: { ...input.payloadRef },
            availableAt: input.availableAt ?? new Date(),
          }),
        )
        .returning();
      return fromOutboxRow(row);
    } catch (e) {
      throw mapPgError(e, "OutboxIntent");
    }
  }

  async findPending(limit: number): Promise<OutboxIntent[]> {
    const rows = await this.db
      .select()
      .from(outbox)
      .where(isNull(outbox.publishedAt))
      .orderBy(asc(outbox.availableAt))
      .limit(limit);
    return rows.map(fromOutboxRow);
  }
}
