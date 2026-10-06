/**
 * Mapper round-trip tests — no Docker, no database.
 *
 * Each entity goes domain -> row -> domain through the real mappers, and
 * the rehydrated entity must equal the original. Tampered rows must fail
 * guarded hydration loudly (never repaired).
 */
import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  Memory,
  newMemoryContainerId,
  newUserId,
  Session,
  User,
  YaoYaoAggregate,
} from "@yaoyao/domain";
import {
  fromCoreStateRow,
  fromEventRow,
  fromMemoryRow,
  fromRelationshipRow,
  fromSessionRow,
  fromUserRow,
  fromYaoYaoRow,
  toCoreStateRow,
  toEventRow,
  toMemoryRow,
  toRelationshipRow,
  toSessionRow,
  toUserRow,
  toYaoYaoRow,
  type CoreStateRow,
  type EventRow,
  type MemoryRow,
  type RelationshipRow,
  type SessionRow,
  type UserRow,
  type YaoYaoRow,
} from "@yaoyao/infrastructure";

function makeAggregate() {
  const userId = newUserId();
  return {
    userId,
    user: User.create({ userId }),
    aggregate: YaoYaoAggregate.create({ userId }),
  };
}

describe("mapper round-trips", () => {
  it("user survives toRow/fromRow", () => {
    const { user } = makeAggregate();
    const back = fromUserRow(toUserRow(user, { email: "a@b.c", passwordHash: "h" }) as unknown as UserRow);
    expect(back.userId).toBe(user.userId);
    expect(back.status).toBe(user.status);
    expect(back.createdAt.getTime()).toBe(user.createdAt.getTime());
  });

  it("yaoyao survives toRow/fromRow with the identity anchor intact", () => {
    const { aggregate } = makeAggregate();
    const back = fromYaoYaoRow(toYaoYaoRow(aggregate.yaoyao));
    expect(back.identityKey).toBe("shen_zhiyao");
    expect(back.yaoyaoId).toBe(aggregate.yaoyaoId);
  });

  it("relationship metrics survive toRow/fromRow", () => {
    const { aggregate } = makeAggregate();
    const rel = aggregate.relationship.recordConflict(0.2, 0.3);
    const back = fromRelationshipRow(toRelationshipRow(rel));
    expect(back.metrics.hurt).toBeCloseTo(0.2, 4);
    expect(back.metrics.conflict).toBeCloseTo(0.3, 4);
    expect(back.type).toBe("deep_partner");
    expect(back.terminationAllowed).toBe(false);
  });

  it("core state survives toRow/fromRow", () => {
    const { aggregate } = makeAggregate();
    const next = aggregate.state.transition(1, { energy: 0.42 });
    const back = fromCoreStateRow(toCoreStateRow(next));
    expect(back.stateVersion).toBe(2);
    expect(back.energy).toBeCloseTo(0.42, 4);
    expect(back.emotion.values).toEqual(next.emotion.values);
  });

  it("session survives toRow/fromRow", () => {
    const { userId, aggregate } = makeAggregate();
    const session = Session.start({ userId, yaoyaoId: aggregate.yaoyaoId });
    const back = fromSessionRow(toSessionRow(session) as unknown as SessionRow);
    expect(back.sessionId).toBe(session.sessionId);
    expect(back.status).toBe("active");
    expect(back.endedAt).toBeNull();
  });

  it("event survives toRow/fromRow with persistence metadata", () => {
    const { userId, aggregate } = makeAggregate();
    const event = DomainEvent.create({
      type: "STATE_CHANGED",
      actor: "YAOYAO",
      userId,
      yaoyaoId: aggregate.yaoyaoId,
      payload: { energy: 0.5 },
    });
    // recorded_at is database-assigned; simulate the post-insert row.
    const stored = {
      ...toEventRow({ event, aggregateSeq: 7, schemaVersion: 1 }),
      recordedAt: new Date(),
    } as unknown as EventRow;
    const back = fromEventRow(stored);
    expect(back.event.eventId).toBe(event.eventId);
    expect(back.event.type).toBe("STATE_CHANGED");
    expect(back.aggregateSeq).toBe(7);
    expect(back.recordedAt).toBeInstanceOf(Date);
  });

  it("memory survives toRow/fromRow", () => {
    const { userId, aggregate } = makeAggregate();
    const memory = Memory.candidate({
      containerId: newMemoryContainerId(),
      userId,
      yaoyaoId: aggregate.yaoyaoId,
      type: "EPISODIC",
      content: "first walk in the park",
      sourceEvents: [],
    });
    const back = fromMemoryRow(toMemoryRow(memory) as unknown as MemoryRow);
    expect(back.memoryId).toBe(memory.memoryId);
    expect(back.status).toBe("CANDIDATE");
    expect(back.timesRecalled).toBe(0);
  });
});

describe("guarded hydration rejects tampered rows", () => {
  /** Assert the guarded hydration fails and the domain cause matches. */
  function expectGuardedRejection(fn: () => unknown, pattern: RegExp) {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const cause = (err as { cause?: unknown }).cause;
      expect(String((cause as Error)?.message ?? err)).toMatch(pattern);
      return;
    }
    throw new Error("expected guarded hydration to throw, but it did not");
  }

  it("rejects a relationship row with a downgraded type", () => {
    const { aggregate } = makeAggregate();
    const row = toRelationshipRow(aggregate.relationship);
    expectGuardedRejection(
      () => fromRelationshipRow({ ...row, type: "partner" } as unknown as RelationshipRow),
      /downgraded relationship/,
    );
  });

  it("rejects a relationship row with termination_allowed=true", () => {
    const { aggregate } = makeAggregate();
    const row = toRelationshipRow(aggregate.relationship);
    expectGuardedRejection(
      () => fromRelationshipRow({ ...row, terminationAllowed: true } as unknown as RelationshipRow),
      /termination_allowed was true/,
    );
  });

  it("rejects a yaoyao row with a wrong identity key", () => {
    const { aggregate } = makeAggregate();
    const row = toYaoYaoRow(aggregate.yaoyao);
    expectGuardedRejection(
      () => fromYaoYaoRow({ ...row, identityKey: "someone_else" } as unknown as YaoYaoRow),
      /identity key must be shen_zhiyao/,
    );
  });

  it("rejects a state row with out-of-range energy", () => {
    const { aggregate } = makeAggregate();
    const row = toCoreStateRow(aggregate.state);
    expectGuardedRejection(
      () => fromCoreStateRow({ ...row, energy: "2" } as unknown as CoreStateRow),
      /energy/,
    );
  });

  it("rejects an event row with an unknown type", () => {
    const { userId, aggregate } = makeAggregate();
    const event = DomainEvent.create({
      type: "SESSION_STARTED",
      actor: "USER",
      userId,
      yaoyaoId: aggregate.yaoyaoId,
    });
    const row = toEventRow({ event, aggregateSeq: 1, schemaVersion: 1 });
    expectGuardedRejection(
      () => fromEventRow({ ...row, type: "HACKED" } as unknown as EventRow),
      /unknown event type/,
    );
  });

  it("rejects an event row with an invalid sequence", () => {
    const { userId, aggregate } = makeAggregate();
    const event = DomainEvent.create({
      type: "SESSION_STARTED",
      actor: "USER",
      userId,
      yaoyaoId: aggregate.yaoyaoId,
    });
    const row = toEventRow({ event, aggregateSeq: 1, schemaVersion: 1 });
    expectGuardedRejection(
      () => fromEventRow({ ...row, aggregateSeq: 0 } as unknown as EventRow),
      /aggregate_seq/,
    );
  });
});
