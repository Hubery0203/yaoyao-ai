/**
 * PostgresMemoryContainerRepository + PostgresMemoryRepository.
 *
 * Provenance check on insert: every source event id must reference an
 * event owned by the same (user_id, yaoyao_id) pair, verified
 * in-transaction. A dangling or foreign provenance id is a storage
 * conflict, not something the mapper repairs.
 */
import {
  EntityNotFoundError,
  PersistenceConflictError,
  type MemoryContainer,
  type MemoryContainerRepository,
  type MemoryRepository,
} from "@yaoyao/application";
import {
  Memory,
  type MemoryContainerId,
  type MemoryId,
  type MemoryStatus,
  type MemoryType,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db.js";
import { mapPgError } from "../errors.js";
import {
  fromMemoryContainerRow,
  fromMemoryRow,
  toMemoryContainerRow,
  toMemoryRow,
} from "../mappers/index.js";
import { events, memories, memoryContainers } from "../schema/index.js";

export class PostgresMemoryContainerRepository
  implements MemoryContainerRepository
{
  constructor(private readonly db: Db) {}

  async findOwned(userId: UserId): Promise<MemoryContainer> {
    const rows = await this.db
      .select()
      .from(memoryContainers)
      .where(eq(memoryContainers.userId, userId as string))
      .limit(1);
    if (rows.length === 0) throw new EntityNotFoundError("MemoryContainer");
    return fromMemoryContainerRow(rows[0]);
  }

  async insert(input: {
    containerId: MemoryContainerId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    schemaVersion?: number;
  }): Promise<MemoryContainer> {
    try {
      const [row] = await this.db
        .insert(memoryContainers)
        .values(
          toMemoryContainerRow({
            containerId: input.containerId,
            userId: input.userId,
            yaoyaoId: input.yaoyaoId,
            schemaVersion: input.schemaVersion ?? 1,
          }),
        )
        .returning();
      return fromMemoryContainerRow(row);
    } catch (e) {
      throw mapPgError(e, "MemoryContainer");
    }
  }
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly db: Db) {}

  async findOwned(userId: UserId, memoryId: MemoryId): Promise<Memory> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, userId as string),
          eq(memories.memoryId, memoryId as string),
        ),
      )
      .limit(1);
    if (rows.length === 0) throw new EntityNotFoundError("Memory");
    return fromMemoryRow(rows[0]);
  }

  async insert(memory: Memory): Promise<void> {
    await this.assertProvenanceOwned(memory);
    try {
      await this.db.insert(memories).values(toMemoryRow(memory));
    } catch (e) {
      throw mapPgError(e, "Memory");
    }
  }

  async save(userId: UserId, memory: Memory): Promise<Memory> {
    await this.assertProvenanceOwned(memory);
    const row = toMemoryRow(memory);
    const rows = await this.db
      .update(memories)
      .set({
        type: row.type,
        content: row.content,
        importance: row.importance,
        confidence: row.confidence,
        sourceEvents: row.sourceEvents,
        status: row.status,
        version: row.version,
        supersedes: row.supersedes,
        archiveReason: row.archiveReason,
        lastRecalledAt: row.lastRecalledAt,
        timesRecalled: row.timesRecalled,
        updatedAt: row.updatedAt,
      })
      .where(
        and(
          eq(memories.userId, userId as string),
          eq(memories.memoryId, memory.memoryId as string),
        ),
      )
      .returning();
    if (rows.length === 0) throw new EntityNotFoundError("Memory");
    return fromMemoryRow(rows[0]);
  }

  async listOwned(
    userId: UserId,
    filter?: { type?: MemoryType; status?: MemoryStatus },
  ): Promise<Memory[]> {
    const conditions = [eq(memories.userId, userId as string)];
    if (filter?.type) conditions.push(eq(memories.type, filter.type));
    if (filter?.status) conditions.push(eq(memories.status, filter.status));
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(asc(memories.updatedAt));
    return rows.map(fromMemoryRow);
  }

  /** Every source event must exist and belong to the same owner pair. */
  private async assertProvenanceOwned(memory: Memory): Promise<void> {
    const ids = memory.sourceEvents;
    if (ids.length === 0) return;
    const idStrings = ids.map((e) => e as string);
    const rows = await this.db
      .select({ eventId: events.eventId })
      .from(events)
      .where(
        and(
          eq(events.userId, memory.userId as string),
          eq(events.yaoyaoId, memory.yaoyaoId as string),
          inArray(events.eventId, idStrings),
        ),
      );
    if (rows.length !== idStrings.length) {
      throw new PersistenceConflictError(
        "memory references events outside the owner scope",
      );
    }
  }
}
