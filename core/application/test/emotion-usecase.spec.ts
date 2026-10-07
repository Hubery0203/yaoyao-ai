/**
 * MVP-002E — applyEmotionProposal use-case unit tests (in-memory fakes).
 *
 * Verifies the transactional write-back logic without Docker:
 * - applied path: version bumps, event appended with causation/correlation
 * - conflict path: stale version → no write, no event
 * - no-change path: empty deltas → nothing persisted
 */
import { describe, expect, it } from "vitest";
import { applyEmotionProposal } from "@yaoyao/application";
import { CoreState } from "@yaoyao/domain";

function fakeTx(initial: CoreState, opts: { casStale?: boolean } = {}) {
  const appended: unknown[] = [];
  return {
    appended,
    states: {
      findOwned: async () => initial,
      saveStateIfVersionMatches: async (
        _userId: unknown,
        expectedVersion: number,
        next: CoreState,
      ) => {
        if (opts.casStale) {
          return {
            outcome: "stale" as const,
            expected: expectedVersion,
            current: expectedVersion + 1,
          };
        }
        return { outcome: "saved" as const, state: next };
      },
    },
    events: {
      append: async (input: { event: { eventId: unknown } }) => {
        appended.push(input.event);
        return {
          event: input.event,
          aggregateSeq: appended.length,
          recordedAt: new Date(),
          schemaVersion: 1,
        };
      },
    },
  } as never;
}

const UID = "u-test" as never;
const YID = "y-test" as never;

function input(version: number, deltas: Record<string, number> = { hurt: 0.1 }) {
  return {
    userId: UID,
    yaoyaoId: YID,
    deltas: deltas as never,
    expectedVersion: version,
    traceId: "trace-unit",
  };
}

describe("applyEmotionProposal (use case)", () => {
  it("applied: bumps version, appends STATE_CHANGED with correlation", async () => {
    const state = CoreState.initial({ userId: UID, yaoyaoId: YID });
    const tx = fakeTx(state);
    const result = await applyEmotionProposal(tx, input(1));
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.newVersion).toBe(2);
      expect(result.newEmotion["hurt"]).toBeCloseTo(0.1);
      expect(tx.appended).toHaveLength(1);
      const event = tx.appended[0] as {
        type: string;
        correlationId: string;
        payload: Record<string, unknown>;
      };
      expect(event.type).toBe("STATE_CHANGED");
      expect(event.correlationId).toBe("trace-unit");
      expect(event.payload["expectedVersion"]).toBe(1);
    }
  });

  it("conflict: stale expected version → no write, no event", async () => {
    const state = CoreState.initial({ userId: UID, yaoyaoId: YID });
    const tx = fakeTx(state);
    const result = await applyEmotionProposal(tx, input(99));
    expect(result.outcome).toBe("conflict");
    expect(tx.appended).toHaveLength(0);
  });

  it("conflict: persistence-level CAS race → no event", async () => {
    const state = CoreState.initial({ userId: UID, yaoyaoId: YID });
    const tx = fakeTx(state, { casStale: true });
    const result = await applyEmotionProposal(tx, input(1));
    expect(result.outcome).toBe("conflict");
    expect(tx.appended).toHaveLength(0);
  });

  it("no-change: empty deltas → nothing persisted", async () => {
    const state = CoreState.initial({ userId: UID, yaoyaoId: YID });
    const tx = fakeTx(state);
    const result = await applyEmotionProposal(tx, input(1, {}));
    expect(result.outcome).toBe("no-change");
    expect(tx.appended).toHaveLength(0);
  });
});
