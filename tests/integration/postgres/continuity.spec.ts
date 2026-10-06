/**
 * T004/T005/T006 facets — session independence, restart continuity,
 * and atomic state+event tracking.
 *
 * T004: closing a session appends exactly one SESSION_ENDED and changes
 * nothing about the companion graph; a new session starts cleanly.
 * T005: disposing the pool (process restart) and reconnecting rehydrates
 * the same identity, bond, state, and history.
 * T006: a meaningful state write and its STATE_CHANGED event commit
 * together with ordered sequencing; an outbox intent rides the same
 * transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPgPool,
  PostgresTransactionManager,
} from "@yaoyao/infrastructure";
import {
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import {
  DomainEvent,
  newUserId,
  Session,
  type UserId,
} from "@yaoyao/domain";
import {
  dockerAvailable,
  setupDatabase,
  APP_PASSWORD,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

async function initUser(db: TestDatabase, userId: UserId) {
  return db.manager.runAsUser(userId, (tx: PersistenceTransaction) =>
    initializeYaoYao(tx, {
      userId,
      email: `ct-${userId.slice(0, 8)}@example.com`,
      passwordHash: "h",
    }),
  );
}

describe.skipIf(!HAS_DOCKER)("T004/T005/T006: sessions, continuity, tracking", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("T004: session close appends one SESSION_ENDED and starts a new session", async () => {
    const userId = newUserId();
    const init = await initUser(db, userId);

    const closed = await db.manager.runAsUser(userId, async (tx) => {
      const session = await tx.sessions.findOwned(userId, init.sessionId);
      const { session: ended, closed } = session.close();
      expect(closed).toBe(true);
      await tx.sessions.save(userId, ended);
      await tx.events.append({
        event: DomainEvent.create({
          type: "SESSION_ENDED",
          actor: "SYSTEM",
          userId,
          yaoyaoId: init.yaoyaoId,
          sessionId: ended.sessionId,
          source: "SYSTEM",
        }),
      });
      // Closing twice is a no-op: no second event.
      const again = await tx.sessions.findOwned(userId, init.sessionId);
      const second = again.close();
      expect(second.closed).toBe(false);
      return ended;
    });
    expect(closed.status).toBe("closed");

    const next = await db.manager.runAsUser(userId, async (tx) => {
      const session = Session.start({ userId, yaoyaoId: init.yaoyaoId });
      await tx.sessions.insert(session);
      await tx.events.append({
        event: DomainEvent.create({
          type: "SESSION_STARTED",
          actor: "USER",
          userId,
          yaoyaoId: init.yaoyaoId,
          sessionId: session.sessionId,
        }),
      });
      return session;
    });

    // The companion graph is untouched by session churn.
    const aggregate = await db.manager.runAsUser(userId, (tx) =>
      tx.aggregates.loadOwned(userId),
    );
    expect(aggregate.yaoyaoId).toBe(init.yaoyaoId);
    expect(aggregate.state.stateVersion).toBe(1);

    const sessions = await db.manager.runAsUser(userId, (tx) =>
      tx.sessions.listOwned(userId),
    );
    expect(sessions.map((s) => s.status).sort()).toEqual(["active", "closed"]);

    const events = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, init.yaoyaoId, 0),
    );
    expect(events.map((e) => e.event.type)).toEqual([
      "USER_CREATED",
      "YAOYAO_CREATED",
      "RELATIONSHIP_CREATED",
      "STATE_CREATED",
      "SESSION_STARTED",
      "SESSION_ENDED",
      "SESSION_STARTED",
    ]);
    expect(events.map((e) => e.aggregateSeq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(next.sessionId).not.toBe(init.sessionId);
  });

  it("T005: pool disposal and reconnect rehydrates the same core", async () => {
    const userId = newUserId();
    const init = await initUser(db, userId);

    // Simulate a process restart: a brand-new pool and manager against the
    // same database rehydrate the identical identity, bond, state, and
    // history — no in-memory state is required.
    const freshPool = createPgPool({
      connectionString: db.connectionStringFor("yaoyao_app", APP_PASSWORD),
      max: 5,
    });
    const freshManager = new PostgresTransactionManager(freshPool);
    try {
      const aggregate = await freshManager.runAsUser(userId, (tx) =>
        tx.aggregates.loadOwned(userId),
      );
      expect(aggregate.yaoyao.identityKey).toBe("shen_zhiyao");
      expect(aggregate.relationship.type).toBe("deep_partner");
      expect(aggregate.state.stateVersion).toBe(1);
      const events = await freshManager.runAsUser(userId, (tx) =>
        tx.events.readOwnedAfter(userId, init.yaoyaoId, 0),
      );
      expect(events).toHaveLength(5);
      expect(events.map((e) => e.event.type)).toEqual([
        "USER_CREATED",
        "YAOYAO_CREATED",
        "RELATIONSHIP_CREATED",
        "STATE_CREATED",
        "SESSION_STARTED",
      ]);
    } finally {
      await freshPool.end();
    }
  });

  it("T006: state write and STATE_CHANGED commit atomically with an outbox intent", async () => {
    const userId = newUserId();
    const init = await initUser(db, userId);

    const saved = await db.manager.runAsUser(userId, async (tx) => {
      const state = await tx.states.findOwned(userId);
      const next = state.transition(state.stateVersion, {
        energy: 0.9,
        relationshipState: "affectionate",
      });
      const result = await tx.states.saveStateIfVersionMatches(
        userId,
        state.stateVersion,
        next,
      );
      if (result.outcome !== "saved") throw new Error("expected save");
      const appended = await tx.events.append({
        event: DomainEvent.create({
          type: "STATE_CHANGED",
          actor: "YAOYAO",
          userId,
          yaoyaoId: init.yaoyaoId,
          payload: { energy: 0.9, relationshipState: "affectionate" },
        }),
      });
      await tx.outbox.enqueueForEvent({
        eventId: appended.event.eventId,
        userId,
        yaoyaoId: init.yaoyaoId,
        topic: "core.state.changed",
        payloadRef: {
          eventId: appended.event.eventId as string,
          aggregateSeq: appended.aggregateSeq,
        },
      });
      return result.state;
    });

    expect(saved.stateVersion).toBe(2);
    expect(saved.energy).toBeCloseTo(0.9, 4);

    const events = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, init.yaoyaoId, 0),
    );
    expect(events.map((e) => e.aggregateSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events[5].event.type).toBe("STATE_CHANGED");

    const pending = await db.manager.runAsUser(userId, (tx) =>
      tx.outbox.findPending(10),
    );
    const ours = pending.filter(
      (p) => (p.userId as string) === (userId as string),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0].topic).toBe("core.state.changed");
    expect(ours[0].eventId).toBe(events[5].event.eventId);
  });
});
