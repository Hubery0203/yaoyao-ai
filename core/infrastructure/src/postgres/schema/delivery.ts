/**
 * Security & delivery tables: refresh_sessions, idempotency_records,
 * outbox, schema_migrations.
 *
 * refresh_sessions stores hashes only — raw refresh tokens never persist.
 * idempotency_records is the authoritative duplicate guard (Redis is only
 * an optional TTL cache). outbox carries delivery *intent*; no relay runs
 * in Phase 3.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bytea } from "./custom.js";
import { events } from "./session-events.js";
import { users, yaoyaos } from "./identity.js";

const tz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

const tzNull = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const refreshSessions = pgTable(
  "refresh_sessions",
  {
    refreshSessionId: uuid("refresh_session_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "restrict" }),
    tokenHash: bytea("token_hash").notNull().unique(),
    tokenFamilyId: uuid("token_family_id").notNull(),
    expiresAt: tz("expires_at"),
    rotatedAt: tzNull("rotated_at"),
    revokedAt: tzNull("revoked_at"),
    deviceMetadata: jsonb("device_metadata")
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: tz("created_at"),
  },
  (t) => [
    check(
      "refresh_sessions_rotated_after_create",
      sql`${t.rotatedAt} IS NULL OR ${t.rotatedAt} >= ${t.createdAt}`,
    ),
    check(
      "refresh_sessions_revoked_after_create",
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`,
    ),
    index("refresh_sessions_owner_family_idx").on(t.userId, t.tokenFamilyId),
    index("refresh_sessions_active_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.revokedAt} IS NULL AND ${t.rotatedAt} IS NULL`),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    idempotencyRecordId: uuid("idempotency_record_id").primaryKey(),
    userScope: text("user_scope").notNull(),
    keyHash: bytea("key_hash").notNull(),
    operation: text("operation").notNull(),
    requestHash: bytea("request_hash").notNull(),
    status: text("status").notNull(),
    responseRef: jsonb("response_ref").$type<Record<string, unknown> | null>(),
    createdAt: tz("created_at"),
    updatedAt: tz("updated_at"),
    expiresAt: tz("expires_at"),
  },
  (t) => [
    uniqueIndex("idempotency_records_key_uidx").on(
      t.userScope,
      t.operation,
      t.keyHash,
    ),
    check(
      "idempotency_records_status_allowed",
      sql`${t.status} IN ('processing','completed','failed')`,
    ),
    check(
      "idempotency_records_expiry_after_create",
      sql`${t.expiresAt} >= ${t.createdAt}`,
    ),
    check("idempotency_records_chronology", sql`${t.updatedAt} >= ${t.createdAt}`),
    index("idempotency_records_expiry_idx").on(t.expiresAt),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    outboxId: uuid("outbox_id").primaryKey(),
    eventId: uuid("event_id").notNull(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    topic: text("topic").notNull(),
    payloadRef: jsonb("payload_ref")
      .notNull()
      .$type<Record<string, unknown>>(),
    availableAt: tz("available_at"),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: tzNull("published_at"),
    lockedAt: tzNull("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
  },
  (t) => [
    foreignKey({
      name: "outbox_event_fk",
      columns: [t.eventId, t.userId, t.yaoyaoId],
      foreignColumns: [events.eventId, events.userId, events.yaoyaoId],
    }).onDelete("restrict"),
    foreignKey({
      name: "outbox_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    // One logical delivery intent per event/topic — duplicate side
    // effects are impossible by construction.
    uniqueIndex("outbox_event_topic_uidx").on(t.eventId, t.topic),
    check("outbox_topic_nonempty", sql`length(${t.topic}) > 0`),
    check(
      "outbox_payload_ref_object",
      sql`jsonb_typeof(${t.payloadRef}) = 'object'`,
    ),
    check("outbox_attempts_min", sql`${t.attempts} >= 0`),
    index("outbox_pending_idx")
      .on(t.availableAt)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);

export const schemaMigrations = pgTable(
  "schema_migrations",
  {
    version: text("version").primaryKey(),
    checksum: text("checksum").notNull(),
    appliedAt: tz("applied_at"),
    appliedBy: text("applied_by").notNull(),
    executionMs: bigint("execution_ms", { mode: "number" }).notNull(),
  },
  (t) => [
    check(
      "schema_migrations_checksum_sha256",
      sql`${t.checksum} ~ '^[0-9a-f]{64}$'`,
    ),
    check("schema_migrations_execution_ms_min", sql`${t.executionMs} >= 0`),
  ],
);
