import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  newEventId,
  newUserId,
  newYaoYaoId,
} from "@yaoyao/domain";

function base() {
  return {
    userId: newUserId(),
    yaoyaoId: newYaoYaoId(),
  };
}

describe("domain events", () => {
  it("creates a valid event with defaults", () => {
    const e = DomainEvent.create({ type: "SESSION_STARTED", actor: "USER", ...base() });
    expect(e.confidence).toBe(1);
    expect(e.source).toBe("CORE");
    expect(e.sessionId).toBeNull();
    expect(e.payload).toEqual({});
  });

  it("events are immutable (frozen)", () => {
    const e = DomainEvent.create({ type: "STATE_CHANGED", actor: "SYSTEM", ...base() });
    expect(Object.isFrozen(e)).toBe(true);
    expect(() => {
      (e as unknown as Record<string, unknown>).type = "HACKED";
    }).toThrow();
  });

  it("lifecycle events require the SYSTEM actor", () => {
    expect(() =>
      DomainEvent.create({ type: "USER_CREATED", actor: "USER", ...base() }),
    ).toThrow();
    expect(() =>
      DomainEvent.create({ type: "USER_CREATED", actor: "SYSTEM", ...base() }),
    ).not.toThrow();
  });

  it("rejects unknown types, actors, sources and bad confidence", () => {
    expect(() =>
      DomainEvent.create({ type: "NOPE" as never, actor: "USER", ...base() }),
    ).toThrow();
    expect(() =>
      DomainEvent.create({
        type: "SESSION_STARTED",
        actor: "USER",
        confidence: 1.5,
        ...base(),
      }),
    ).toThrow();
    expect(() =>
      DomainEvent.create({
        type: "SESSION_STARTED",
        actor: "USER",
        payload: [] as unknown as Record<string, unknown>,
        ...base(),
      }),
    ).toThrow();
  });

  it("supports causation and correlation linkage", () => {
    const cause = newEventId();
    const e = DomainEvent.create({
      type: "STATE_CHANGED",
      actor: "SYSTEM",
      causationId: cause,
      correlationId: "cmd-123",
      ...base(),
    });
    expect(e.causationId).toBe(cause);
    expect(e.correlationId).toBe("cmd-123");
  });
});
