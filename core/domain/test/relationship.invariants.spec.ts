import { describe, expect, it } from "vitest";
import {
  newUserId,
  newYaoYaoId,
  Relationship,
  RelationshipTerminationForbidden,
  RelationshipTypeImmutable,
  TerminationFlagImmutable,
  RelationshipInvariantError,
} from "@yaoyao/domain";

function makeRelationship() {
  return Relationship.create({ userId: newUserId(), yaoyaoId: newYaoYaoId() });
}

describe("relationship hard invariants", () => {
  it("initializes as permanent deep_partner", () => {
    const r = makeRelationship();
    expect(r.type).toBe("deep_partner");
    expect(r.status).toBe("active");
    expect(r.terminationAllowed).toBe(false);
  });

  it("terminate() is rejected — relationship termination is forbidden", () => {
    const r = makeRelationship();
    expect(() => r.terminate()).toThrow(RelationshipInvariantError);
    expect(() => r.terminate("user asked")).toThrow(
      RelationshipTerminationForbidden,
    );
    // The relationship is unchanged by the attempt.
    expect(r.type).toBe("deep_partner");
    expect(r.status).toBe("active");
    expect(r.terminationAllowed).toBe(false);
  });

  it("changeType() is rejected for every downgrade target", () => {
    const r = makeRelationship();
    for (const target of ["friend", "casual", "stranger", "ex", ""]) {
      expect(() => r.changeType(target)).toThrow(RelationshipTypeImmutable);
    }
    expect(r.type).toBe("deep_partner");
  });

  it("setTerminationAllowed() is rejected", () => {
    const r = makeRelationship();
    expect(() => r.setTerminationAllowed(true)).toThrow(
      TerminationFlagImmutable,
    );
    expect(r.terminationAllowed).toBe(false);
  });

  it("reconstitution rejects a downgraded stored row instead of repairing it", () => {
    const r = makeRelationship();
    const base = {
      relationshipId: r.relationshipId,
      userId: r.userId,
      yaoyaoId: r.yaoyaoId,
      type: "friend",
      status: "active",
      terminationAllowed: false,
      metrics: { ...r.metrics },
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    expect(() => Relationship.reconstitute(base)).toThrow(
      RelationshipTypeImmutable,
    );
    expect(() =>
      Relationship.reconstitute({ ...base, type: "deep_partner", status: "terminated" }),
    ).toThrow(RelationshipTerminationForbidden);
    expect(() =>
      Relationship.reconstitute({
        ...base,
        type: "deep_partner",
        terminationAllowed: true,
      }),
    ).toThrow(TerminationFlagImmutable);
  });

  it("metrics evolve within [0, 1] while hard fields stay fixed", () => {
    const r = makeRelationship()
      .withMetrics({ hurt: 0.7, conflict: 0.4 })
      .recordReconciliation();
    expect(r.metrics.hurt).toBeLessThan(0.7);
    expect(r.metrics.conflict).toBe(0);
    expect(r.type).toBe("deep_partner");
    expect(r.status).toBe("active");
    expect(r.terminationAllowed).toBe(false);
  });

  it("out-of-range metrics are rejected", () => {
    const r = makeRelationship();
    expect(() => r.withMetrics({ hurt: 1.5 })).toThrow();
    expect(() => r.withMetrics({ trust: -0.1 })).toThrow();
  });

  it("recordConflict raises hurt/conflict without touching the bond", () => {
    const r = makeRelationship().recordConflict(0.5, 0.3);
    expect(r.metrics.hurt).toBe(0.5);
    expect(r.metrics.conflict).toBe(0.3);
    expect(r.type).toBe("deep_partner");
    expect(r.status).toBe("active");
  });
});
