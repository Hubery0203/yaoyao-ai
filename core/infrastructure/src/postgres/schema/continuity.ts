/** Storage shape for the reconstructed 003A durable queue. RLS lives in SQL. */
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, unique, index, check, foreignKey } from "drizzle-orm/pg-core";
import { events } from "./session-events.js";
export const continuityJobs = pgTable("continuity_jobs", {
  jobId: uuid("job_id").primaryKey(),
  userId: uuid("user_id").notNull(),
  yaoyaoId: uuid("yaoyao_id").notNull(),
  requestId: text("request_id").notNull(),
  assistantEventId: uuid("assistant_event_id").notNull().unique(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => [
  unique().on(t.userId, t.yaoyaoId, t.requestId),
  foreignKey({ columns: [t.assistantEventId, t.userId, t.yaoyaoId], foreignColumns: [events.eventId, events.userId, events.yaoyaoId] }).onDelete("restrict"),
  index("continuity_jobs_pending_idx").on(t.userId,t.createdAt,t.jobId).where(sql`${t.status}='pending'`),
  index("continuity_jobs_expiry_idx").on(t.userId,t.leaseExpiresAt).where(sql`${t.status}='claimed'`),
  check("continuity_jobs_request_id_check", sql`length(${t.requestId})>0`),
  check("continuity_jobs_status_check", sql`${t.status} IN ('pending','claimed','completed')`),
  check("continuity_jobs_attempts_check", sql`${t.attempts}>=0`),
  check("continuity_jobs_check", sql`(${t.status}='claimed')=(${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`),
  check("continuity_jobs_check1", sql`${t.status}='claimed' OR (${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`),
  check("continuity_jobs_check2", sql`(${t.status}='completed')=(${t.completedAt} IS NOT NULL)`),
]);
