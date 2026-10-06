import { describe, expect, it } from "vitest";
import { newUserId, newYaoYaoId, Session } from "@yaoyao/domain";

describe("session lifecycle", () => {
  it("starts active with no end time", () => {
    const s = Session.start({ userId: newUserId(), yaoyaoId: newYaoYaoId() });
    expect(s.isActive).toBe(true);
    expect(s.endedAt).toBeNull();
    expect(s.status).toBe("active");
  });

  it("close() ends the session once", () => {
    const s = Session.start({ userId: newUserId(), yaoyaoId: newYaoYaoId() });
    const { session: closed, closed: didClose } = s.close();
    expect(didClose).toBe(true);
    expect(closed.status).toBe("closed");
    expect(closed.endedAt).toBeInstanceOf(Date);
    expect(closed.endedAt!.getTime()).toBeGreaterThanOrEqual(
      closed.startedAt.getTime(),
    );
  });

  it("close() is idempotent — no second close, no duplicate effect (T004 domain form)", () => {
    const s = Session.start({ userId: newUserId(), yaoyaoId: newYaoYaoId() });
    const first = s.close();
    const second = first.session.close();
    expect(second.closed).toBe(false);
    expect(second.session.endedAt?.getTime()).toBe(
      first.session.endedAt?.getTime(),
    );
  });

  it("a new session can start after the previous one closed", () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const s1 = Session.start({ userId, yaoyaoId }).close().session;
    const s2 = Session.start({ userId, yaoyaoId });
    expect(s1.status).toBe("closed");
    expect(s2.status).toBe("active");
    expect(s2.sessionId).not.toBe(s1.sessionId);
  });

  it("reconstitution rejects end-before-start", () => {
    const s = Session.start({ userId: newUserId(), yaoyaoId: newYaoYaoId() });
    expect(() =>
      Session.reconstitute({
        sessionId: s.sessionId,
        userId: s.userId,
        yaoyaoId: s.yaoyaoId,
        startedAt: new Date("2026-10-06T10:00:00Z"),
        endedAt: new Date("2026-10-06T09:00:00Z"),
        status: "closed",
        clientInstanceId: null,
      }),
    ).toThrow();
  });
});
