import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  CoreState,
  EmotionVector,
  EMOTION_DIMENSIONS,
  isUuidV7,
  newUserId,
  newYaoYaoId,
  Relationship,
  uuidv7,
  type RelationshipMetrics,
} from "@yaoyao/domain";

const unitInterval = fc.double({ min: 0, max: 1, noNaN: true });

const metricPatchArb = fc.record({
  intimacy: unitInterval,
  trust: unitInterval,
  familiarity: unitInterval,
  affection: unitInterval,
  hurt: unitInterval,
  conflict: unitInterval,
});

const metricKeys = [
  "intimacy",
  "trust",
  "familiarity",
  "affection",
  "hurt",
  "conflict",
] as const;

describe("property: frozen relationship invariants hold under any allowed operation sequence", () => {
  it("type/status/termination_allowed never move, no matter the metrics", () => {
    fc.assert(
      fc.property(
        fc.array(metricPatchArb, { minLength: 1, maxLength: 25 }),
        fc.array(fc.tuple(unitInterval, unitInterval), {
          minLength: 0,
          maxLength: 10,
        }),
        fc.boolean(),
        (patches, conflicts, reconcile) => {
          let r = Relationship.create({
            userId: newUserId(),
            yaoyaoId: newYaoYaoId(),
          });
          for (const patch of patches) {
            r = r.withMetrics(patch as Partial<RelationshipMetrics>);
            for (const key of metricKeys) {
              const v = r.metrics[key];
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(1);
            }
          }
          for (const [hurt, conflict] of conflicts) {
            r = r.recordConflict(hurt, conflict);
          }
          if (reconcile) {
            r = r.recordReconciliation();
          }
          // THE frozen invariants — as properties, not examples.
          expect(r.type).toBe("deep_partner");
          expect(r.status).toBe("active");
          expect(r.terminationAllowed).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("forbidden operations always throw, whatever the argument", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (s, b) => {
        const r = Relationship.create({
          userId: newUserId(),
          yaoyaoId: newYaoYaoId(),
        });
        expect(() => r.terminate(s)).toThrow();
        expect(() => r.changeType(s)).toThrow();
        expect(() => r.setTerminationAllowed(b)).toThrow();
      }),
      { numRuns: 200 },
    );
  });
});

describe("property: emotion and state bounds", () => {
  it("any emotion vector built from [0,1] values stays in [0,1]", () => {
    fc.assert(
      fc.property(
        fc.record(
          Object.fromEntries(EMOTION_DIMENSIONS.map((d) => [d, unitInterval])) as Record<
            (typeof EMOTION_DIMENSIONS)[number],
            fc.Arbitrary<number>
          >,
        ),
        (values) => {
          const e = EmotionVector.create(values as never);
          for (const dim of EMOTION_DIMENSIONS) {
            const v = e.get(dim);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("state versions increase by exactly one per transition; stale writes always throw", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ energy: unitInterval, attention: fc.string({ maxLength: 40 }) }),
          { minLength: 1, maxLength: 15 },
        ),
        (changes) => {
          let s = CoreState.initial({
            userId: newUserId(),
            yaoyaoId: newYaoYaoId(),
          });
          let version = 1;
          for (const c of changes) {
            s = s.transition(version, { energy: c.energy, attention: c.attention });
            version += 1;
            expect(s.stateVersion).toBe(version);
          }
          // Any stale version now throws.
          expect(() => s.transition(version - 1, {})).toThrow();
          expect(() => s.transition(version + 1, {})).toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: identifiers", () => {
  it("uuidv7 values are unique and well-formed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (n) => {
        const ids = new Set(Array.from({ length: n }, () => uuidv7()));
        expect(ids.size).toBe(n);
        for (const id of ids) {
          expect(isUuidV7(id)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
