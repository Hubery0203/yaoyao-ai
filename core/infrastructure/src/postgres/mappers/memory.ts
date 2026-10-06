/**
 * Memory + MemoryContainer mappers.
 *
 * Memory.reconstitute() validates type, status, scores, version chain, and
 * chronology. The embedding column is never read or written in MVP-001.
 * source_events maps to branded EventIds; provenance ownership is verified
 * by the repository in-transaction, not by the mapper.
 */
import {
  Memory,
  type EventId,
  type MemoryContainerId,
  type MemoryId,
  type MemoryStatus,
  type MemoryType,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import type { MemoryContainer } from "@yaoyao/application";
import { memories, memoryContainers } from "../schema/index.js";
import {
  asDate,
  asNullableDate,
  branded,
  hydrate,
  numericToNumber,
} from "./primitives.js";

export type MemoryRow = typeof memories.$inferSelect;
export type MemoryInsert = typeof memories.$inferInsert;
export type MemoryContainerRow = typeof memoryContainers.$inferSelect;
export type MemoryContainerInsert = typeof memoryContainers.$inferInsert;

const TABLE = "memories";
const CONTAINER_TABLE = "memory_containers";

export function toMemoryRow(memory: Memory): MemoryInsert {
  return {
    memoryId: memory.memoryId as string,
    containerId: memory.containerId as string,
    userId: memory.userId as string,
    yaoyaoId: memory.yaoyaoId as string,
    type: memory.type,
    content: memory.content,
    importance: String(memory.importance),
    confidence: String(memory.confidence),
    sourceEvents: memory.sourceEvents.map((e) => e as string),
    status: memory.status,
    version: memory.version,
    supersedes: memory.supersedes ? (memory.supersedes as string) : null,
    archiveReason: memory.archiveReason,
    lastRecalledAt: memory.lastRecalledAt,
    timesRecalled: memory.timesRecalled,
    // embedding intentionally unset — NULL in MVP-001.
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export function fromMemoryRow(row: MemoryRow): Memory {
  return hydrate(TABLE, row.memoryId, () =>
    Memory.reconstitute({
      memoryId: branded<MemoryId>(row.memoryId, "memory_id", TABLE),
      containerId: branded<MemoryContainerId>(
        row.containerId,
        "container_id",
        TABLE,
      ),
      userId: branded<UserId>(row.userId, "user_id", TABLE),
      yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", TABLE),
      type: row.type as MemoryType,
      content: row.content,
      importance: numericToNumber(row.importance, "importance", TABLE),
      confidence: numericToNumber(row.confidence, "confidence", TABLE),
      sourceEvents: (row.sourceEvents ?? []).map((e) =>
        branded<EventId>(e, "source_events[]", TABLE),
      ),
      status: row.status as MemoryStatus,
      version: row.version,
      supersedes:
        row.supersedes === null
          ? null
          : branded<MemoryId>(row.supersedes, "supersedes", TABLE),
      archiveReason: row.archiveReason,
      createdAt: asDate(row.createdAt, "created_at", TABLE),
      updatedAt: asDate(row.updatedAt, "updated_at", TABLE),
      lastRecalledAt: asNullableDate(row.lastRecalledAt, "last_recalled_at", TABLE),
      timesRecalled: row.timesRecalled,
    }),
  );
}

export function toMemoryContainerRow(input: {
  containerId: MemoryContainerId;
  userId: UserId;
  yaoyaoId: YaoYaoId;
  schemaVersion: number;
}): MemoryContainerInsert {
  return {
    containerId: input.containerId as string,
    userId: input.userId as string,
    yaoyaoId: input.yaoyaoId as string,
    schemaVersion: input.schemaVersion,
    createdAt: new Date(),
  };
}

export function fromMemoryContainerRow(row: MemoryContainerRow): MemoryContainer {
  return hydrate(CONTAINER_TABLE, row.containerId, () => ({
    containerId: branded<MemoryContainerId>(
      row.containerId,
      "container_id",
      CONTAINER_TABLE,
    ),
    userId: branded<UserId>(row.userId, "user_id", CONTAINER_TABLE),
    yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", CONTAINER_TABLE),
    schemaVersion: row.schemaVersion,
    createdAt: asDate(row.createdAt, "created_at", CONTAINER_TABLE),
  }));
}
