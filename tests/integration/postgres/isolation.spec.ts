/**
 * T008 facet — ownership isolation under real RLS and a shared pool.
 *
 * - Cross-user resource access returns not-found with no existence leak.
 * - RLS filters rows even when the adapter's owner predicate is bypassed
 *   via raw SQL.
 * - Pooled-connection reuse never leaks one user's SET LOCAL context into
 *   another's (the required follow-through proof).
 * - Composite FKs reject cross-owner edge inserts.
 * - A forged yaoyao_id grants nothing: every read is scoped by user_id.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EntityNotFoundError,
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import { newSessionId, newUserId, type UserId } from "@yaoyao/domain";
import {
  dockerAvailable,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

async function initUser(db: TestDatabase, userId: UserId) {
  return db.manager.runAsUser(userId, (tx: PersistenceTransaction) =>
    initializeYaoYao(tx, {
      userId,
      email: `iso-${userId.slice(0, 8)}@example.com`,
      passwordHash: "h",
    }),
  );
}

describe.skipIf(!HAS_DOCKER)("T008: ownership isolation", () => {
  let db: TestDatabase;
  let userA: UserId;
  let userB: UserId;
  let sessionB: string;

  beforeAll(async () => {
    db = await setupDatabase();
    userA = newUserId();
    userB = newUserId();
    await initUser(db, userA);
    const b = await initUser(db, userB);
    sessionB = b.sessionId as string;
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("returns not-found (not forbidden) for another user's session id", async () => {
    // Same response as a missing id: no existence signal leaks.
    await expect(
      db.manager.runAsUser(userA, (tx) =>
        tx.sessions.findOwned(userA, sessionB as never),
      ),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
    await expect(
      db.manager.runAsUser(userA, (tx) =>
        tx.sessions.findOwned(userA, "00000000-0000-7000-8000-000000000000" as never),
      ),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it("a forged yaoyao_id yields no rows under another user's scope", async () => {
    const yaoyaoB = (
      await db.manager.runAsUser(userB, (tx) => tx.aggregates.loadOwned(userB))
    ).yaoyaoId;
    const rows = await db.manager.runAsUser(userA, (tx) =>
      tx.events.readOwnedAfter(userA, yaoyaoB, 0),
    );
    expect(rows).toHaveLength(0);
  });

  it("RLS filters rows when raw SQL bypasses the adapter predicate", async () => {
    const client = await db.appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userA as string,
      ]);
      const { rows } = await client.query(
        `SELECT user_id FROM events`, // no WHERE — RLS must still scope
      );
      await client.query("ROLLBACK");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.user_id).toBe(userA as string);
    } finally {
      client.release();
    }
  });

  it("pooled-connection reuse never leaks owner context", async () => {
    // Mechanism proof on ONE client: SET LOCAL is transaction-scoped.
    const client = await db.appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userA as string,
      ]);
      const scoped = await client.query(`SELECT * FROM events`);
      expect(scoped.rows.length).toBeGreaterThan(0);
      await client.query("COMMIT");
      // Same client, new transaction, no context set: RLS hides everything.
      await client.query("BEGIN");
      const bare = await client.query(`SELECT * FROM events`);
      await client.query("ROLLBACK");
      expect(bare.rows).toHaveLength(0);
    } finally {
      client.release();
    }

    // Integration level: real traffic as A through the manager, then a raw
    // grab from the shared pool must observe no leaked context.
    await db.manager.runAsUser(userA, (tx) => tx.aggregates.loadOwned(userA));
    const raw = await db.appPool.connect();
    try {
      const events = await raw.query(`SELECT * FROM events`);
      const states = await raw.query(`SELECT * FROM core_states`);
      expect(events.rows).toHaveLength(0);
      expect(states.rows).toHaveLength(0);
    } finally {
      raw.release();
    }

    // And B's scoped traffic still sees exactly B's rows.
    const bEvents = await db.manager.runAsUser(userB, async (tx) => {
      const agg = await tx.aggregates.loadOwned(userB);
      return tx.events.readOwnedAfter(userB, agg.yaoyaoId, 0);
    });
    expect(bEvents).toHaveLength(5);
    expect(
      bEvents.every((e) => (e.event.userId as string) === (userB as string)),
    ).toBe(true);
  });

  it("each owner sees exactly their own five init events", async () => {
    const readAll = (u: UserId) =>
      db.manager.runAsUser(u, async (tx) => {
        const agg = await tx.aggregates.loadOwned(u);
        return tx.events.readOwnedAfter(u, agg.yaoyaoId, 0);
      });
    const [aEvents, bEvents] = await Promise.all([readAll(userA), readAll(userB)]);
    expect(aEvents).toHaveLength(5);
    expect(bEvents).toHaveLength(5);
    expect(
      aEvents.every((e) => (e.event.userId as string) === (userA as string)),
    ).toBe(true);
    expect(
      bEvents.every((e) => (e.event.userId as string) === (userB as string)),
    ).toBe(true);
  });

  it("composite FKs reject cross-owner edge inserts", async () => {
    const yaoyaoB = (
      await db.manager.runAsUser(userB, (tx) => tx.aggregates.loadOwned(userB))
    ).yaoyaoId;
    await expect(
      db.adminPool.query(
        `INSERT INTO sessions (session_id, user_id, yaoyao_id, started_at, status)
         VALUES ($1, $2, $3, now(), 'active')`,
        [newSessionId() as string, userA as string, yaoyaoB as string],
      ),
    ).rejects.toThrow(/foreign key|violates/i);
  });
});
