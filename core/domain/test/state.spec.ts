import { describe, expect, it } from "vitest";
import {
  CoreState,
  EmotionVector,
  EMOTION_DIMENSIONS,
  newUserId,
  newYaoYaoId,
  StaleStateVersionError,
} from "@yaoyao/domain";

function makeState() {
  return CoreState.initial({ userId: newUserId(), yaoyaoId: newYaoYaoId() });
}

describe("emotion vector", () => {
  it("covers all nine MVP dimensions within [0, 1]", () => {
    const e = EmotionVector.initial();
    expect(EMOTION_DIMENSIONS).toHaveLength(9);
    for (const dim of EMOTION_DIMENSIONS) {
      const v = e.get(dim);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("rejects out-of-range values", () => {
    const base = EmotionVector.initial();
    expect(() => base.with({ happiness: 2 })).toThrow();
    expect(() => base.with({ sadness: -0.5 })).toThrow();
  });

  it("is immutable — with() returns a new vector", () => {
    const a = EmotionVector.initial();
    const b = a.with({ happiness: 0.9 });
    expect(a.get("happiness")).not.toBe(0.9);
    expect(b.get("happiness")).toBe(0.9);
  });
});

describe("core state transitions", () => {
  it("starts at version 1", () => {
    expect(makeState().stateVersion).toBe(1);
  });

  it("a valid transition bumps the version exactly once", () => {
    const s1 = makeState();
    const s2 = s1.transition(1, { energy: 0.5 });
    expect(s2.stateVersion).toBe(2);
    expect(s2.energy).toBe(0.5);
    // The original snapshot is untouched.
    expect(s1.stateVersion).toBe(1);
  });

  it("a stale expectedVersion is rejected, never blind-overwritten (T010 domain form)", () => {
    const s1 = makeState();
    const s2 = s1.transition(1, { energy: 0.5 });
    expect(() => s2.transition(1, { energy: 0.9 })).toThrow(
      StaleStateVersionError,
    );
    // The committed state is intact.
    expect(s2.energy).toBe(0.5);
    expect(s2.stateVersion).toBe(2);
  });

  it("operational relationship state moves without touching the bond", () => {
    const s = makeState().transition(1, { relationshipState: "conflicted" });
    expect(s.relationshipState).toBe("conflicted");
    expect(s.stateVersion).toBe(2);
  });

  it("rejects unknown operational states and bad energy", () => {
    const s = makeState();
    expect(() =>
      s.transition(1, { relationshipState: "divorced" as never }),
    ).toThrow();
    expect(() => s.transition(1, { energy: 5 })).toThrow();
  });

  it("reconstitution enforces bounds", () => {
    const s = makeState();
    expect(() =>
      CoreState.reconstitute({
        stateId: s.stateId,
        userId: s.userId,
        yaoyaoId: s.yaoyaoId,
        emotion: { ...s.emotion.values, happiness: 99 },
        energy: 0.5,
        socialState: "resting",
        relationshipState: "calm",
        attention: "",
        internalState: {},
        stateVersion: 3,
        lastUpdated: new Date(),
      }),
    ).toThrow();
  });
});
