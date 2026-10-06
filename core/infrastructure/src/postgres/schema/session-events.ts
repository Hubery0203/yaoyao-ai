/**
 * sessions + events tables.
 *
 * Events are append-only: the application role receives SELECT + INSERT
 * only (grants in the migration), and a BEFORE UPDATE OR DELETE trigger
 * rejects direct mutation as a second line of defense. aggregate_seq —
 * not wall-clock time — is the authoritative replay order.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { yaoyaos } from "./identity.js";

const tz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const sessions = pgTable(
  "sessions",
  {
    sessionId: uuid("session_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    startedAt: tz("started_at"),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    status: text("status").notNull(),
    clientInstanceId: text("client_instance_id"),
  },
  (t) => [
    foreignKey({
      name: "sessions_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    // Composite key target for the event ownership FK.
    uniqueIndex("sessions_session_owner_uidx").on(
      t.sessionId,
      t.userId,
      t.yaoyaoId,
    ),
    check(
      "sessions_ended_after_start",
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    check("sessions_status_allowed", sql`${t.status} IN ('active','closed')`),
    check(
      "sessions_status_coherence",
      sql`(${t.status} = 'active' AND ${t.endedAt} IS NULL) OR (${t.status} = 'closed' AND ${t.endedAt} IS NOT NULL)`,
    ),
    index("sessions_owner_status_idx").on(t.userId, t.status, t.startedAt),
    index("sessions_owner_started_idx").on(t.userId, t.yaoyaoId, t.startedAt),
  ],
);

export const events = pgTable(
  "events",
  {
    eventId: uuid("event_id").primaryKey(),
    aggregateSeq: bigint("aggregate_seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    source: text("source").notNull(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    sessionId: uuid("session_id"),
    occurredAt: tz("occurred_at"),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`clock_timestamp()`),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    causationId: uuid("causation_id"),
    correlationId: text("correlation_id"),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    foreignKey({
      name: "events_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    // Ownership FK: a session-scoped event can only reference a session
    // owned by the same user/YaoYao pair. NULL session_id = non-session event.
    foreignKey({
      name: "events_session_fk",
      columns: [t.sessionId, t.userId, t.yaoyaoId],
      foreignColumns: [sessions.sessionId, sessions.userId, sessions.yaoyaoId],
    }).onDelete("restrict"),
    foreignKey({
      name: "events_causation_fk",
      columns: [t.causationId],
      foreignColumns: [t.eventId],
    }).onDelete("restrict"),
    // Per-YaoYao ordering: the final race guard for sequence allocation.
    uniqueIndex("events_yaoyao_seq_uidx").on(t.yaoyaoId, t.aggregateSeq),
    uniqueIndex("events_event_owner_uidx").on(t.eventId, t.userId, t.yaoyaoId),
    check("events_seq_min", sql`${t.aggregateSeq} >= 1`),
    check(
      "events_type_allowed",
      sql`${t.type} IN ('USER_CREATED','YAOYAO_CREATED','RELATIONSHIP_CREATED','STATE_CREATED','SESSION_STARTED','SESSION_ENDED','STATE_CHANGED','MEMORY_CORRECTED')`,
    ),
    check(
      "events_actor_allowed",
      sql`${t.actor} IN ('USER','YAOYAO','SYSTEM')`,
    ),
    check(
      "events_source_allowed",
      sql`${t.source} IN ('CLIENT','CORE','SYSTEM','MIGRATION')`,
    ),
    check(
      "events_payload_object",
      sql`jsonb_typeof(${t.payload}) = 'object'`,
    ),
    check(
      "events_confidence_01",
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
    check("events_schema_version_min", sql`${t.schemaVersion} >= 1`),
    index("events_replay_idx").on(t.userId, t.yaoyaoId, t.aggregateSeq),
    index("events_owner_recorded_idx").on(t.userId, t.recordedAt),
    index("events_session_seq_idx")
      .on(t.sessionId, t.aggregateSeq)
      .where(sql`${t.sessionId} IS NOT NULL`),
    index("events_owner_type_idx").on(t.userId, t.type, t.recordedAt),
  ],
);
