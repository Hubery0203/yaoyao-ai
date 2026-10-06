/**
 * Refresh-session, idempotency, and outbox mappers.
 *
 * These tables carry no domain entities; the mappers translate between
 * driver rows and the plain structural types declared in the application
 * ports. Hashing (SHA-256) lives in ../idempotency/hash.js.
 */
import type {
  IdempotencyRecord,
  IdempotencyStatus,
  MemoryContainer,
  OutboxIntent,
  RefreshSessionRecord,
} from "@yaoyao/application";
import type { EventId, UserId, YaoYaoId } from "@yaoyao/domain";
import {
  idempotencyRecords,
  outbox,
  refreshSessions,
} from "../schema/index.js";
import {
  asDate,
  asNullableDate,
  asRecord,
  branded,
  hydrate,
} from "./primitives.js";

export type RefreshSessionRow = typeof refreshSessions.$inferSelect;
export type RefreshSessionInsert = typeof refreshSessions.$inferInsert;
export type IdempotencyRow = typeof idempotencyRecords.$inferSelect;
export type IdempotencyInsert = typeof idempotencyRecords.$inferInsert;
export type OutboxRow = typeof outbox.$inferSelect;
export type OutboxInsert = typeof outbox.$inferInsert;

const RS_TABLE = "refresh_sessions";
const IDEM_TABLE = "idempotency_records";
const OUTBOX_TABLE = "outbox";

function asBuffer(raw: unknown, column: string, table: string): Buffer {
  if (!Buffer.isBuffer(raw)) {
    throw new Error(`${table}.${column} is not a Buffer`);
  }
  return Buffer.from(raw);
}

export function toRefreshSessionRow(input: {
  refreshSessionId: string;
  userId: UserId;
  tokenHash: Buffer;
  tokenFamilyId: string;
  expiresAt: Date;
  deviceMetadata: Record<string, unknown>;
}): RefreshSessionInsert {
  return {
    refreshSessionId: input.refreshSessionId,
    userId: input.userId as string,
    tokenHash: input.tokenHash,
    tokenFamilyId: input.tokenFamilyId,
    expiresAt: input.expiresAt,
    deviceMetadata: input.deviceMetadata,
    createdAt: new Date(),
  };
}

export function fromRefreshSessionRow(row: RefreshSessionRow): RefreshSessionRecord {
  return hydrate(RS_TABLE, row.refreshSessionId, () => ({
    refreshSessionId: row.refreshSessionId,
    userId: branded<UserId>(row.userId, "user_id", RS_TABLE),
    tokenHash: asBuffer(row.tokenHash, "token_hash", RS_TABLE),
    tokenFamilyId: row.tokenFamilyId,
    expiresAt: asDate(row.expiresAt, "expires_at", RS_TABLE),
    rotatedAt: asNullableDate(row.rotatedAt, "rotated_at", RS_TABLE),
    revokedAt: asNullableDate(row.revokedAt, "revoked_at", RS_TABLE),
    deviceMetadata: asRecord(row.deviceMetadata, "device_metadata", RS_TABLE),
    createdAt: asDate(row.createdAt, "created_at", RS_TABLE),
  }));
}

export function toIdempotencyRow(input: {
  idempotencyRecordId: string;
  userScope: string;
  keyHash: Buffer;
  operation: string;
  requestHash: Buffer;
  status: IdempotencyStatus;
  expiresAt: Date;
}): IdempotencyInsert {
  const now = new Date();
  return {
    idempotencyRecordId: input.idempotencyRecordId,
    userScope: input.userScope,
    keyHash: input.keyHash,
    operation: input.operation,
    requestHash: input.requestHash,
    status: input.status,
    responseRef: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
  };
}

export function fromIdempotencyRow(row: IdempotencyRow): IdempotencyRecord {
  return hydrate(IDEM_TABLE, row.idempotencyRecordId, () => ({
    userScope: row.userScope,
    operation: row.operation,
    keyHash: asBuffer(row.keyHash, "key_hash", IDEM_TABLE),
    requestHash: asBuffer(row.requestHash, "request_hash", IDEM_TABLE),
    status: row.status as IdempotencyStatus,
    responseRef:
      row.responseRef === null
        ? null
        : asRecord(row.responseRef, "response_ref", IDEM_TABLE),
    expiresAt: asDate(row.expiresAt, "expires_at", IDEM_TABLE),
  }));
}

export function toOutboxRow(input: {
  outboxId: string;
  eventId: EventId;
  userId: UserId;
  yaoyaoId: YaoYaoId;
  topic: string;
  payloadRef: Record<string, unknown>;
  availableAt: Date;
}): OutboxInsert {
  return {
    outboxId: input.outboxId,
    eventId: input.eventId as string,
    userId: input.userId as string,
    yaoyaoId: input.yaoyaoId as string,
    topic: input.topic,
    payloadRef: input.payloadRef,
    availableAt: input.availableAt,
  };
}

export function fromOutboxRow(row: OutboxRow): OutboxIntent {
  return hydrate(OUTBOX_TABLE, row.outboxId, () => ({
    outboxId: row.outboxId,
    eventId: branded<EventId>(row.eventId, "event_id", OUTBOX_TABLE),
    userId: branded<UserId>(row.userId, "user_id", OUTBOX_TABLE),
    yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", OUTBOX_TABLE),
    topic: row.topic,
    payloadRef: asRecord(row.payloadRef, "payload_ref", OUTBOX_TABLE),
    availableAt: asDate(row.availableAt, "available_at", OUTBOX_TABLE),
  }));
}

/** Structural re-export so repositories share the container shape. */
export type { MemoryContainer };
