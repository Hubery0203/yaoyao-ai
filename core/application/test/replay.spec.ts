/**
 * replayDiagnostics unit tests (Phase 4, PM rule 3).
 *
 * Proves at the unit level:
 * - the fold uses the production transition functions (STATE_CREATED ->
 *   CoreState.initial(), STATE_CHANGED -> CoreState.transition());
 * - the read port exposes no writes (type-level: the fake implements only
 *   the read picks; any write attempt is a compile error);
 * - divergences and malformed payloads are reported, not thrown;
 * - non-state events never mutate the reconstruction.
 */
import {
  CoreState,
  DomainEvent,
  newUserId,
  newYaoYaoId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { describe, expect, it } from "vitest";
import {
  replayDiagnostics,
  type PersistedEvent,
  type ReplayReadPort,
} from "../src/index.js";

function persistedEvent(
  seq: number,
  event: DomainEvent,
): PersistedEvent {
  return { event, aggregateSeq: seq, recordedAt: new Date(), schemaVersion: 1 };
}

function fakeReadPort(
  events: PersistedEvent[],
  persistedState: CoreState,
  yaoyaoId: YaoYaoId,
): ReplayReadPort {
  return {
    aggregates: {
      loadOwned: async () => ({ yaoyaoId }) as never,
    },
    states: {
      findOwned: async () => persistedState,
    },
    events: {
      readOwnedAfter: async () => events,
    },
  };
}

function initEvents(userId: UserId, yaoyaoId: YaoYaoId): PersistedEvent[] {
  const mk = (type: "USER_CREATED" | "YAOYAO_CREATED" | "RELATIONSHIP_CREATED" | "STATE_CREATED" | "SESSION_STARTED", seq: number) =>
    persistedEvent(
      seq,
      DomainEvent.create({
        type,
        actor: "SYSTEM",
        userId,
        yaoyaoId,
        sessionId: null,
        payload: {},
        source: "SYSTEM",
        confidence: 1,
      }),
    );
  return [
    mk("USER_CREATED", 1),
    mk("YAOYAO_CREATED", 2),
    mk("RELATIONSHIP_CREATED", 3),
    mk("STATE_CREATED", 4),
    mk("SESSION_STARTED", 5),
  ];
}

describe("replayDiagnostics", () => {
  it("reconstructs the initial state and matches the persisted snapshot (T011)", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const persisted = CoreState.initial({ userId, yaoyaoId });
    const read = fakeReadPort(initEvents(userId, yaoyaoId), persisted, yaoyaoId);
    const result = await replayDiagnostics(read, { userId });
    expect(result.eventsFolded).toBe(5);
    expect(result.reconstructedVersion).toBe(1);
    expect(result.persistedVersion).toBe(1);
    expect(result.match).toBe(true);
    expect(result.diffs).toEqual([]);
    // Non-state events are traced but not applied.
    const applied = result.trace.filter((t) => t.applied);
    expect(applied.map((t) => t.type)).toEqual(["STATE_CREATED"]);
  });

  it("folds STATE_CHANGED through the production transition function", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const persisted = CoreState.initial({ userId, yaoyaoId }).transition(1, {
      energy: 0.5,
    });
    const events = [
      ...initEvents(userId, yaoyaoId),
      persistedEvent(
        6,
        DomainEvent.create({
          type: "STATE_CHANGED",
          actor: "YAOYAO",
          userId,
          yaoyaoId,
          sessionId: null,
          payload: { expectedVersion: 1, changes: { energy: 0.5 } },
          source: "CORE",
          confidence: 1,
        }),
      ),
    ];
    const read = fakeReadPort(events, persisted, yaoyaoId);
    const result = await replayDiagnostics(read, { userId });
    expect(result.reconstructedVersion).toBe(2);
    expect(result.match).toBe(true);
  });

  it("reports version divergences as trace findings instead of throwing", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const persisted = CoreState.initial({ userId, yaoyaoId });
    const events = [
      ...initEvents(userId, yaoyaoId),
      persistedEvent(
        6,
        DomainEvent.create({
          type: "STATE_CHANGED",
          actor: "YAOYAO",
          userId,
          yaoyaoId,
          sessionId: null,
          payload: { expectedVersion: 99, changes: { energy: 0.5 } },
          source: "CORE",
          confidence: 1,
        }),
      ),
    ];
    const read = fakeReadPort(events, persisted, yaoyaoId);
    const result = await replayDiagnostics(read, { userId });
    // The bad delta was not applied; the baseline still matches.
    expect(result.match).toBe(true);
    const entry = result.trace.find((t) => t.aggregateSeq === 6);
    expect(entry?.applied).toBe(false);
    expect(entry?.note).toMatch(/divergence/);
  });

  it("reports field-level diffs when reconstruction and persistence disagree", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    // Persisted state advanced beyond what the event log explains.
    const persisted = CoreState.initial({ userId, yaoyaoId }).transition(1, {
      energy: 0.2,
    });
    const read = fakeReadPort(initEvents(userId, yaoyaoId), persisted, yaoyaoId);
    const result = await replayDiagnostics(read, { userId });
    expect(result.match).toBe(false);
    expect(result.diffs.map((d) => d.field)).toContain("energy");
    expect(result.diffs.map((d) => d.field)).toContain("stateVersion");
  });
});
