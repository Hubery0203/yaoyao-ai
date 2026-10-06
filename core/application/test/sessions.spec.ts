/**
 * Session use-case unit tests (Phase 4).
 *
 * Covers: session start (with aggregate existence check + SESSION_STARTED
 * event), idempotent start via the user-scoped idempotency slot, close
 * (with SESSION_ENDED event), idempotent re-close, and owner-scoped
 * resolution (a valid JWT never implies ownership of a foreign session).
 */
import {
  Session,
  newSessionId,
  newUserId,
  newYaoYaoId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { describe, expect, it } from "vitest";
import {
  EntityNotFoundError,
  closeSession,
  startSession,
} from "../src/index.js";
import { fakeTransaction } from "./fakes.js";

function sessionTx(userId: UserId, yaoyaoId: YaoYaoId) {
  const calls: string[] = [];
  const sessions = new Map<string, Session>();
  const tx = fakeTransaction({
    aggregates: {
      loadOwned: async (uid: UserId) => {
        calls.push(`aggregates.loadOwned:${uid as string}`);
        if ((uid as string) !== (userId as string)) {
          throw new EntityNotFoundError("YaoYaoAggregate");
        }
        return { yaoyaoId } as never;
      },
    } as never,
    sessions: {
      insert: async (s: Session) => {
        calls.push("sessions.insert");
        sessions.set(s.sessionId as string, s);
      },
      findOwned: async (uid: UserId, sid: string) => {
        const s = sessions.get(sid);
        if (!s || (s.userId as string) !== (uid as string)) {
          throw new EntityNotFoundError("Session");
        }
        return s;
      },
      save: async (_uid: UserId, s: Session) => {
        calls.push("sessions.save");
        sessions.set(s.sessionId as string, s);
        return s;
      },
    } as never,
    events: {
      append: async (input: { event: { type: string } }) => {
        calls.push(`events.append:${input.event.type}`);
        return { event: input.event, aggregateSeq: 1, recordedAt: new Date(), schemaVersion: 1 };
      },
    } as never,
    idempotency: {
      begin: async () => ({ outcome: "claimed" }) as const,
      complete: async () => {
        calls.push("idempotency.complete");
      },
      fail: async () => undefined,
      find: async () => null,
    } as never,
  });
  return { tx, calls, sessions };
}

describe("startSession", () => {
  it("opens a session against the owner's aggregate and appends SESSION_STARTED", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const { tx, calls } = sessionTx(userId, yaoyaoId);
    const result = await startSession(tx, { userId });
    expect(result.yaoyaoId).toBe(yaoyaoId);
    expect(result.duplicate).toBe(false);
    expect(calls).toContain(`aggregates.loadOwned:${userId as string}`);
    expect(calls).toContain("sessions.insert");
    expect(calls).toContain("events.append:SESSION_STARTED");
  });

  it("returns the existing session on idempotent retry", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const existingId = newSessionId();
    const tx = fakeTransaction({
      aggregates: { loadOwned: async () => ({ yaoyaoId }) as never } as never,
      sessions: { insert: async () => undefined } as never,
      events: { append: async (i: never) => i } as never,
      idempotency: {
        begin: async () =>
          ({
            outcome: "existing",
            record: {
              status: "completed",
              responseRef: { sessionId: existingId, yaoyaoId },
            },
            requestMatches: true,
          }) as const,
        complete: async () => undefined,
        fail: async () => undefined,
        find: async () => null,
      } as never,
    });
    const result = await startSession(tx, {
      userId,
      idempotency: { key: "k", requestBody: "{}" },
    });
    expect(result).toEqual({
      sessionId: existingId,
      yaoyaoId,
      duplicate: true,
    });
  });

  it("fails when the owner has no Core (aggregate 404)", async () => {
    const userId = newUserId();
    const { tx } = sessionTx(newUserId(), newYaoYaoId());
    await expect(startSession(tx, { userId })).rejects.toBeInstanceOf(
      EntityNotFoundError,
    );
  });
});

describe("closeSession", () => {
  it("closes an owned session and appends SESSION_ENDED", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const { tx, calls, sessions } = sessionTx(userId, yaoyaoId);
    const s = Session.start({ userId, yaoyaoId });
    sessions.set(s.sessionId as string, s);
    const result = await closeSession(tx, { userId, sessionId: s.sessionId });
    expect(result).toEqual({ sessionId: s.sessionId, closed: true });
    expect(calls).toContain("sessions.save");
    expect(calls).toContain("events.append:SESSION_ENDED");
  });

  it("is idempotent: re-closing appends no second event", async () => {
    const userId = newUserId();
    const yaoyaoId = newYaoYaoId();
    const { tx, calls, sessions } = sessionTx(userId, yaoyaoId);
    const s = Session.start({ userId, yaoyaoId });
    const { session: closed } = s.close();
    sessions.set(s.sessionId as string, closed);
    const result = await closeSession(tx, { userId, sessionId: s.sessionId });
    expect(result.closed).toBe(false);
    expect(calls).not.toContain("events.append:SESSION_ENDED");
  });

  it("404s for a session owned by someone else (no oracle leak)", async () => {
    const owner = newUserId();
    const intruder = newUserId();
    const yaoyaoId = newYaoYaoId();
    const { tx, sessions } = sessionTx(owner, yaoyaoId);
    const s = Session.start({ userId: owner, yaoyaoId });
    sessions.set(s.sessionId as string, s);
    await expect(
      closeSession(tx, { userId: intruder, sessionId: s.sessionId }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });
});
