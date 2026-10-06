/**
 * Event mapper.
 *
 * The frozen domain exposes no reconstitute() for events; hydration goes
 * through DomainEvent.create(), which re-validates the event catalog, the
 * SYSTEM-only lifecycle rule, confidence bounds, and payload shape. The
 * mapper additionally guards the persistence-assigned fields
 * (aggregate_seq, recorded_at, schema_version) that the domain never sees.
 */
import { PersistenceMappingError } from "@yaoyao/application";
import {
  DomainEvent,
  type EventActor,
  type EventId,
  type EventSource,
  type EventType,
  type SessionId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import type { PersistedEvent } from "@yaoyao/application";
import { events } from "../schema/index.js";
import {
  asDate,
  asRecord,
  branded,
  hydrate,
  numericToNumber,
} from "./primitives.js";

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;

const TABLE = "events";

export function toEventRow(input: {
  event: DomainEvent;
  aggregateSeq: number;
  schemaVersion: number;
}): EventInsert {
  const e = input.event;
  if (!Number.isInteger(input.aggregateSeq) || input.aggregateSeq < 1) {
    throw new PersistenceMappingError(
      TABLE,
      `aggregate_seq must be an integer >= 1, got ${input.aggregateSeq}`,
    );
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new PersistenceMappingError(
      TABLE,
      `schema_version must be an integer >= 1, got ${input.schemaVersion}`,
    );
  }
  return {
    eventId: e.eventId as string,
    aggregateSeq: input.aggregateSeq,
    type: e.type,
    actor: e.actor,
    source: e.source,
    userId: e.userId as string,
    yaoyaoId: e.yaoyaoId as string,
    sessionId: e.sessionId ? (e.sessionId as string) : null,
    occurredAt: e.occurredAt,
    // recordedAt is database-assigned (clock_timestamp() default).
    payload: { ...e.payload },
    confidence: String(e.confidence),
    causationId: e.causationId ? (e.causationId as string) : null,
    correlationId: e.correlationId,
    schemaVersion: input.schemaVersion,
  };
}

export function fromEventRow(row: EventRow): PersistedEvent {
  return hydrate(TABLE, row.eventId, () => {
    if (!Number.isInteger(row.aggregateSeq) || row.aggregateSeq < 1) {
      throw new PersistenceMappingError(
        TABLE,
        `stored aggregate_seq is invalid: ${row.aggregateSeq}`,
      );
    }
    if (!Number.isInteger(row.schemaVersion) || row.schemaVersion < 1) {
      throw new PersistenceMappingError(
        TABLE,
        `stored schema_version is invalid: ${row.schemaVersion}`,
      );
    }
    const event = DomainEvent.create({
      eventId: branded<EventId>(row.eventId, "event_id", TABLE),
      type: row.type as EventType,
      actor: row.actor as EventActor,
      userId: branded<UserId>(row.userId, "user_id", TABLE),
      yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", TABLE),
      sessionId:
        row.sessionId === null
          ? null
          : branded<SessionId>(row.sessionId, "session_id", TABLE),
      occurredAt: asDate(row.occurredAt, "occurred_at", TABLE),
      payload: asRecord(row.payload, "payload", TABLE),
      source: row.source as EventSource,
      confidence: numericToNumber(row.confidence, "confidence", TABLE),
      causationId:
        row.causationId === null
          ? null
          : branded<EventId>(row.causationId, "causation_id", TABLE),
      correlationId: row.correlationId,
    });
    return {
      event,
      aggregateSeq: row.aggregateSeq,
      recordedAt: asDate(row.recordedAt, "recorded_at", TABLE),
      schemaVersion: row.schemaVersion,
    };
  });
}
