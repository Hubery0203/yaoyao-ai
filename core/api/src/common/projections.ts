/**
 * Client-safe projections (proposal §F).
 *
 * Allowlist mappers: each function constructs the response shape field by
 * field. Anything not listed here can never be serialized — password
 * hashes, refresh-token hashes, RLS context, outbox rows, idempotency
 * records, and migration metadata have no projection and therefore no
 * route to the client.
 *
 * Unit tests assert the absence of forbidden fields per projection.
 */
import {
  EMOTION_DIMENSIONS,
  type CoreState,
  type DomainEvent,
  type Memory,
  type Relationship,
  type Session,
  type User,
  type YaoYao,
} from "@yaoyao/domain";
import type { PersistedEvent } from "@yaoyao/application";

export interface ClientUser {
  userId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function projectUser(user: User): ClientUser {
  return {
    userId: user.userId as string,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export interface ClientYaoYaoIdentity {
  yaoyaoId: string;
  identityKey: string;
  identityVersion: string;
  status: string;
  createdAt: string;
}

export function projectYaoYaoIdentity(yaoyao: YaoYao): ClientYaoYaoIdentity {
  return {
    yaoyaoId: yaoyao.yaoyaoId as string,
    identityKey: yaoyao.identityKey,
    identityVersion: yaoyao.identityVersion,
    status: yaoyao.status,
    createdAt: yaoyao.createdAt.toISOString(),
  };
}

export interface ClientRelationship {
  relationshipId: string;
  type: string;
  status: string;
  /** The termination prohibition is a frozen invariant — surfaced, never mutable. */
  terminationAllowed: boolean;
  metrics: {
    intimacy: number;
    trust: number;
    familiarity: number;
    affection: number;
    hurt: number;
    conflict: number;
  };
  updatedAt: string;
}

export function projectRelationship(
  relationship: Relationship,
): ClientRelationship {
  const m = relationship.metrics;
  return {
    relationshipId: relationship.relationshipId as string,
    type: relationship.type,
    status: relationship.status,
    terminationAllowed: relationship.terminationAllowed,
    metrics: {
      intimacy: m.intimacy,
      trust: m.trust,
      familiarity: m.familiarity,
      affection: m.affection,
      hurt: m.hurt,
      conflict: m.conflict,
    },
    updatedAt: relationship.updatedAt.toISOString(),
  };
}

export interface ClientState {
  stateId: string;
  stateVersion: number;
  emotion: Record<string, number>;
  energy: number;
  socialState: string;
  relationshipState: string;
  attention: string;
  internalState: Record<string, string | undefined>;
  lastUpdated: string;
}

export function projectState(state: CoreState): ClientState {
  const emotion: Record<string, number> = {};
  for (const dim of EMOTION_DIMENSIONS) {
    emotion[dim] = state.emotion.get(dim);
  }
  return {
    stateId: state.stateId as string,
    stateVersion: state.stateVersion,
    emotion,
    energy: state.energy,
    socialState: state.socialState,
    relationshipState: state.relationshipState,
    attention: state.attention,
    internalState: { ...state.internalState },
    lastUpdated: state.lastUpdated.toISOString(),
  };
}

export interface ClientSession {
  sessionId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export function projectSession(session: Session): ClientSession {
  return {
    sessionId: session.sessionId as string,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
  };
}

export interface ClientEvent {
  eventId: string;
  aggregateSeq: number;
  type: string;
  occurredAt: string;
  recordedAt: string;
  actor: string;
  sessionId: string | null;
  source: string;
  confidence: number;
  /** Owner-scoped payload; internal-only fields are stripped at the domain mapper. */
  payload: Record<string, unknown>;
}

export function projectEvent(persisted: PersistedEvent): ClientEvent {
  const event: DomainEvent = persisted.event;
  return {
    eventId: event.eventId as string,
    aggregateSeq: persisted.aggregateSeq,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    recordedAt: persisted.recordedAt.toISOString(),
    actor: event.actor,
    sessionId: event.sessionId ? (event.sessionId as string) : null,
    source: event.source,
    confidence: event.confidence,
    payload: { ...event.payload },
  };
}

export interface ClientMemory {
  memoryId: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
}

export function projectMemory(memory: Memory): ClientMemory {
  return {
    memoryId: memory.memoryId as string,
    type: memory.type,
    content: memory.content,
    importance: memory.importance,
    confidence: memory.confidence,
    status: memory.status,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    lastRecalledAt: memory.lastRecalledAt
      ? memory.lastRecalledAt.toISOString()
      : null,
  };
}
