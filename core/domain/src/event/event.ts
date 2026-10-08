import { DomainValidationError } from "../shared/errors.js";
import { assertUnitInterval, assertValidDate } from "../shared/guards.js";
import {
  newEventId,
  type EventId,
  type SessionId,
  type UserId,
  type YaoYaoId,
} from "../shared/ids.js";

/** MVP-001 event catalog (Data Model §4). Append-only; never edited. */
export const EVENT_TYPES = [
  "USER_CREATED",
  "YAOYAO_CREATED",
  "RELATIONSHIP_CREATED",
  "STATE_CREATED",
  "SESSION_STARTED",
  "SESSION_ENDED",
  "STATE_CHANGED",
  "MEMORY_CORRECTED",
  // MVP-002G (additive): conversation message events for C6 history.
  // Purely additive — no existing type semantics modified.
  "USER_MESSAGE",
  "ASSISTANT_MESSAGE",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_ACTORS = ["USER", "YAOYAO", "SYSTEM"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

export const EVENT_SOURCES = ["CLIENT", "CORE", "SYSTEM", "MIGRATION"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Lifecycle events must come from SYSTEM, not from user/client input. */
const SYSTEM_ONLY_TYPES: ReadonlySet<EventType> = new Set([
  "USER_CREATED",
  "YAOYAO_CREATED",
  "RELATIONSHIP_CREATED",
  "STATE_CREATED",
]);

/**
 * DomainEvent — an immutable fact: what happened.
 *
 * Events are never silently modified; corrections arrive as new events
 * (e.g. MEMORY_CORRECTED). The object is frozen at creation. Per-YaoYao
 * ordering (aggregate_seq) is assigned at persistence (Phase 3); the
 * domain carries occurred_at as descriptive metadata only.
 */
export class DomainEvent {
  private constructor(
    readonly eventId: EventId,
    readonly type: EventType,
    readonly occurredAt: Date,
    readonly actor: EventActor,
    readonly userId: UserId,
    readonly yaoyaoId: YaoYaoId,
    readonly sessionId: SessionId | null,
    readonly payload: Readonly<Record<string, unknown>>,
    readonly source: EventSource,
    readonly confidence: number,
    readonly causationId: EventId | null,
    readonly correlationId: string | null,
  ) {
    Object.freeze(this);
  }

  static create(input: {
    type: EventType;
    actor: EventActor;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    sessionId?: SessionId | null;
    payload?: Record<string, unknown>;
    source?: EventSource;
    confidence?: number;
    occurredAt?: Date;
    causationId?: EventId | null;
    correlationId?: string | null;
    eventId?: EventId;
  }): DomainEvent {
    if (!EVENT_TYPES.includes(input.type)) {
      throw new DomainValidationError(`unknown event type: ${input.type}`);
    }
    if (!EVENT_ACTORS.includes(input.actor)) {
      throw new DomainValidationError(`unknown event actor: ${input.actor}`);
    }
    if (SYSTEM_ONLY_TYPES.has(input.type) && input.actor !== "SYSTEM") {
      throw new DomainValidationError(
        `lifecycle event ${input.type} must have actor SYSTEM, got ${input.actor}`,
      );
    }
    const source = input.source ?? "CORE";
    if (!EVENT_SOURCES.includes(source)) {
      throw new DomainValidationError(`unknown event source: ${source}`);
    }
    const confidence = input.confidence ?? 1;
    assertUnitInterval(confidence, "confidence");
    const occurredAt = input.occurredAt ?? new Date();
    assertValidDate(occurredAt, "occurredAt");
    const payload = input.payload ?? {};
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DomainValidationError("event payload must be a plain object");
    }
    return new DomainEvent(
      input.eventId ?? newEventId(),
      input.type,
      occurredAt,
      input.actor,
      input.userId,
      input.yaoyaoId,
      input.sessionId ?? null,
      Object.freeze({ ...payload }),
      source,
      confidence,
      input.causationId ?? null,
      input.correlationId ?? null,
    );
  }
}
