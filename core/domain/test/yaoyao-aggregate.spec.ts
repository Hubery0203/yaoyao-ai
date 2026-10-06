import { describe, expect, it } from "vitest";
import {
  CoreState,
  IDENTITY_KEY_SHEN_ZHIYAO,
  newUserId,
  newYaoYaoId,
  Relationship,
  User,
  YaoYao,
  YaoYaoAggregate,
} from "@yaoyao/domain";

describe("user aggregate boundary", () => {
  it("creates an active user identity", () => {
    const u = User.create();
    expect(u.isActive).toBe(true);
    expect(u.status).toBe("active");
  });

  it("suspend/reactivate cycle keeps the same identity", () => {
    const u = User.create().suspend().reactivate();
    expect(u.isActive).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(() => User.create({ status: "ghost" as never })).toThrow();
  });
});

describe("yaoyao identity", () => {
  it("is always 沈知遥 / 遥遥 — the identity key is a literal type", () => {
    const y = YaoYao.create({ userId: newUserId() });
    expect(y.identityKey).toBe(IDENTITY_KEY_SHEN_ZHIYAO);
    expect(y.identityKey).toBe("shen_zhiyao");
    expect(y.status).toBe("active");
  });

  it("reconstitution rejects a foreign identity key", () => {
    const y = YaoYao.create({ userId: newUserId() });
    expect(() =>
      YaoYao.reconstitute({
        yaoyaoId: y.yaoyaoId,
        userId: y.userId,
        identityKey: "someone_else",
        identityVersion: "0.1",
        status: "active",
        createdAt: y.createdAt,
        updatedAt: y.updatedAt,
      }),
    ).toThrow();
  });

  it("identity definition version may grow (L1); the key has no mutator (L0)", () => {
    const y = YaoYao.create({ userId: newUserId() }).withIdentityVersion("0.2");
    expect(y.identityVersion).toBe("0.2");
    expect(y.identityKey).toBe("shen_zhiyao");
    expect(
      "withIdentityKey" in (y as unknown as Record<string, unknown>),
    ).toBe(false);
  });
});

describe("yaoyao aggregate", () => {
  it("creates one identity, one bond, one state sharing the same ids", () => {
    const userId = newUserId();
    const agg = YaoYaoAggregate.create({ userId });
    expect(agg.userId).toBe(userId);
    expect(agg.yaoyao.yaoyaoId).toBe(agg.yaoyaoId);
    expect(agg.relationship.yaoyaoId).toBe(agg.yaoyaoId);
    expect(agg.state.yaoyaoId).toBe(agg.yaoyaoId);
    expect(agg.relationship.type).toBe("deep_partner");
    expect(agg.state.stateVersion).toBe(1);
  });

  it("rejects mismatched composition", () => {
    const agg = YaoYaoAggregate.create({ userId: newUserId() });
    const foreign = Relationship.create({
      userId: newUserId(),
      yaoyaoId: newYaoYaoId(),
    });
    expect(() => agg.withRelationship(foreign)).toThrow();
    const foreignState = CoreState.initial({
      userId: newUserId(),
      yaoyaoId: newYaoYaoId(),
    });
    expect(() => agg.withState(foreignState)).toThrow();
  });

  it("with* returns a new aggregate; the original is untouched", () => {
    const agg = YaoYaoAggregate.create({ userId: newUserId() });
    const next = agg.withState(agg.state.transition(1, { energy: 0.2 }));
    expect(next.state.stateVersion).toBe(2);
    expect(agg.state.stateVersion).toBe(1);
  });
});
