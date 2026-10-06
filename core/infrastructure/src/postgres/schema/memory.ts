/**
 * memory_containers + memories tables.
 *
 * The container is storage bookkeeping for the 1:1 grouping (no domain
 * entity); Memory.reconstitute() validates every semantic field on
 * hydration. The embedding column stays NULL in MVP-001.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { vector } from "./custom.js";
import { yaoyaos } from "./identity.js";

const tz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

const score = (name: string) =>
  numeric(name, { precision: 5, scale: 4 }).notNull();

export const memoryContainers = pgTable(
  "memory_containers",
  {
    containerId: uuid("container_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: tz("created_at"),
  },
  (t) => [
    foreignKey({
      name: "memory_containers_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    uniqueIndex("memory_containers_yaoyao_uidx").on(t.yaoyaoId),
    uniqueIndex("memory_containers_owner_uidx").on(
      t.containerId,
      t.userId,
      t.yaoyaoId,
    ),
    check(
      "memory_containers_schema_version_min",
      sql`${t.schemaVersion} >= 1`,
    ),
  ],
);

export const memories = pgTable(
  "memories",
  {
    memoryId: uuid("memory_id").primaryKey(),
    containerId: uuid("container_id").notNull(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    type: text("type").notNull(),
    content: text("content").notNull(),
    importance: score("importance"),
    confidence: score("confidence"),
    sourceEvents: uuid("source_events")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text("status").notNull(),
    version: integer("version").notNull(),
    supersedes: uuid("supersedes"),
    archiveReason: text("archive_reason"),
    lastRecalledAt: timestamp("last_recalled_at", {
      withTimezone: true,
      mode: "date",
    }),
    timesRecalled: bigint("times_recalled", { mode: "number" }).notNull(),
    embedding: vector("embedding"),
    createdAt: tz("created_at"),
    updatedAt: tz("updated_at"),
  },
  (t) => [
    foreignKey({
      name: "memories_container_fk",
      columns: [t.containerId, t.userId, t.yaoyaoId],
      foreignColumns: [
        memoryContainers.containerId,
        memoryContainers.userId,
        memoryContainers.yaoyaoId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "memories_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    foreignKey({
      name: "memories_supersedes_fk",
      columns: [t.supersedes],
      foreignColumns: [t.memoryId],
    }).onDelete("restrict"),
    check(
      "memories_type_allowed",
      sql`${t.type} IN ('CORE','SEMANTIC','EPISODIC','SHARED_LIFE')`,
    ),
    check(
      "memories_status_allowed",
      sql`${t.status} IN ('CANDIDATE','VALIDATED','CONSOLIDATED','CORRECTED','ARCHIVED')`,
    ),
    check("memories_content_nonempty", sql`length(${t.content}) > 0`),
    check(
      "memories_importance_01",
      sql`${t.importance} >= 0 AND ${t.importance} <= 1`,
    ),
    check(
      "memories_confidence_01",
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
    check("memories_version_min", sql`${t.version} >= 1`),
    check(
      "memories_times_recalled_min",
      sql`${t.timesRecalled} >= 0`,
    ),
    check("memories_chronology", sql`${t.updatedAt} >= ${t.createdAt}`),
    // A memory version can supersede at most one predecessor (partial unique).
    uniqueIndex("memories_supersedes_uidx")
      .on(t.supersedes)
      .where(sql`${t.supersedes} IS NOT NULL`),
    index("memories_owner_lookup_idx").on(
      t.userId,
      t.type,
      t.status,
      t.updatedAt,
    ),
    index("memories_source_events_gin").using(
      "gin",
      t.sourceEvents,
    ),
  ],
);
