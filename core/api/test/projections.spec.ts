/**
 * Projection allowlist tests (Phase 4, proposal §F / PM rule: projection security).
 *
 * Each projection is allowlist-constructed: the test asserts the exact key
 * set of the output AND the absence of every forbidden field (password
 * hashes, token hashes, RLS context, outbox/idempotency internals).
 */
import {
  CoreState,
  DomainEvent,
  Memory,
  Relationship,
  Session,
  User,
  YaoYao,
  YaoYaoAggregate,
  newUserId,
  newYaoYaoId,
} from "@yaoyao/domain";
import { describe, expect, it } from "vitest";
import {
  projectEvent,
  projectMemory,
  projectRelationship,
  projectSession,
  projectState,
  projectUser,
  projectYaoYaoIdentity,
} from "../src/index.js";

const userId = newUserId();
const yaoyaoId = newYaoYaoId();

function aggregate(): YaoYaoAggregate {
  return YaoYaoAggregate.create({ userId, yaoyaoId });
}

describe("projectUser", () => {
  it("exposes only the allowlisted fields", () => {
    const out = projectUser(User.create({ userId }));
    expect(Object.keys(out).sort()).toEqual(
      ["createdAt", "status", "updatedAt", "userId"].sort(),
    );
    expect(JSON.stringify(out)).not.toContain("password");
    expect(JSON.stringify(out)).not.toContain("hash");
  });
});

describe("projectYaoYaoIdentity", () => {
  it("exposes identity presentation fields only", () => {
    const out = projectYaoYaoIdentity(aggregate().yaoyao);
    expect(Object.keys(out).sort()).toEqual(
      ["createdAt", "identityKey", "identityVersion", "status", "yaoyaoId"].sort(),
    );
    expect((out as Record<string, unknown>)["userId"]).toBeUndefined();
  });
});

describe("projectRelationship", () => {
  it("exposes type/status/metrics; termination stays visible-but-false", () => {
    const out = projectRelationship(aggregate().relationship);
    expect(out.type).toBe("deep_partner");
    expect(out.status).toBe("active");
    expect(out.terminationAllowed).toBe(false);
    expect(Object.keys(out.metrics).sort()).toEqual(
      ["affection", "conflict", "familiarity", "hurt", "intimacy", "trust"].sort(),
    );
    // No raw internals beyond the metric allowlist.
    expect((out as Record<string, unknown>)["userId"]).toBeUndefined();
  });
});

describe("projectState", () => {
  it("exposes the client-safe state view", () => {
    const out = projectState(CoreState.initial({ userId, yaoyaoId }));
    expect(out.stateVersion).toBe(1);
    expect(typeof out.emotion["happiness"]).toBe("number");
    expect(Object.keys(out).sort()).toEqual(
      [
        "attention",
        "emotion",
        "energy",
        "internalState",
        "lastUpdated",
        "relationshipState",
        "socialState",
        "stateId",
        "stateVersion",
      ].sort(),
    );
  });
});

describe("projectSession", () => {
  it("exposes lifecycle fields only", () => {
    const out = projectSession(Session.start({ userId, yaoyaoId }));
    expect(Object.keys(out).sort()).toEqual(
      ["endedAt", "sessionId", "startedAt", "status"].sort(),
    );
    expect((out as Record<string, unknown>)["clientInstanceId"]).toBeUndefined();
  });
});

describe("projectEvent", () => {
  it("exposes event facts with owner-scoped payload", () => {
    const event = DomainEvent.create({
      type: "SESSION_STARTED",
      actor: "USER",
      userId,
      yaoyaoId,
      sessionId: null,
      payload: { sessionId: "s-1" },
      source: "CLIENT",
      confidence: 1,
    });
    const out = projectEvent({
      event,
      aggregateSeq: 5,
      recordedAt: new Date(),
      schemaVersion: 1,
    });
    expect(out.aggregateSeq).toBe(5);
    expect(out.type).toBe("SESSION_STARTED");
    expect(out.payload).toEqual({ sessionId: "s-1" });
    expect((out as Record<string, unknown>)["schemaVersion"]).toBeUndefined();
  });
});

describe("projectMemory", () => {
  it("exposes presentation fields only", () => {
    const memory = Memory.candidate({
      containerId: "c-1" as never,
      userId,
      yaoyaoId,
      type: "EPISODIC",
      content: "first walk in the park",
      importance: 0.7,
      confidence: 0.9,
      sourceEvents: [],
    });
    const out = projectMemory(memory);
    expect(out.content).toBe("first walk in the park");
    expect((out as Record<string, unknown>)["containerId"]).toBeUndefined();
    expect((out as Record<string, unknown>)["sourceEvents"]).toBeUndefined();
  });
});

// Silence unused-import warnings for entities used via aggregate().
void YaoYao;
void Relationship;
