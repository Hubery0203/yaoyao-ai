/**
 * T010 facet — real concurrent writes against real PostgreSQL.
 *
 * Two connections race a compare-and-swap on the same state version:
 * exactly one wins; the loser observes the stale outcome with the live
 * version. Concurrent event appends serialize through the advisory lock
 * and receive gapless, unique per-YaoYao sequences.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DomainEvent,
  newUserId,
  type UserId,
} from "@yaoyao/domain";
import {
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
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
      email: `cc-${userId}@example.com`,
      passwordHash: "h",
    }),
  );
}

describe.skipIf(!HAS_DOCKER)("T010: concurrent compare-and-swap", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("admits exactly one winner for concurrent version-1 writes", async () => {
    const userId = newUserId();
    const { yaoyaoId } = await initUser(db, userId);

    // Read version 1 deterministically BEFORE the race: both writers must
    // attempt a version-1 -> 2 CAS. Reading inside the race lets the loser
    // observe the winner's version 2 and attempt a version-3 write, which
    // the repository correctly refuses as an incoherent jump.
    const v1 = await db.manager.runAsUser(userId, (tx) =>
      tx.states.findOwned(userId),
    );
    expect(v1.stateVersion).toBe(1);

    // Both racers CAS on version 1 over independent pooled connections.
    const race = await Promise.all([
      db.manager.runAsUser(userId, (tx) => {
        const next = v1.transition(v1.stateVersion, { energy: 0.11 });
        return tx.states.saveStateIfVersionMatches(userId, 1, next);
      }),
      db.manager.runAsUser(userId, (tx) => {
        const next = v1.transition(v1.stateVersion, { energy: 0.22 });
        return tx.states.saveStateIfVersionMatches(userId, 1, next);
      }),
    ]);

    const saved = race.filter((r) => r.outcome === "saved");
    const stale = race.filter((r) => r.outcome === "stale");
    expect(saved).toHaveLength(1);
    expect(stale).toHaveLength(1);
    if (stale[0].outcome === "stale") {
      expect(stale[0].expected).toBe(1);
      expect(stale[0].current).toBe(2);
    }

    // The stored row is exactly version 2 with one winner's energy.
    const final = await db.manager.runAsUser(userId, (tx) =>
      tx.states.findOwned(userId),
    );
    expect(final.stateVersion).toBe(2);
    expect([0.11, 0.22]).toContain(final.energy);
    void yaoyaoId;
  });

  it("serializes concurrent event appends into gapless sequences", async () => {
    const userId = newUserId();
    const { yaoyaoId } = await initUser(db, userId);

    const appends = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db.manager.runAsUser(userId, (tx) =>
          tx.events.append({
            event: DomainEvent.create({
              type: "STATE_CHANGED",
              actor: "YAOYAO",
              userId,
              yaoyaoId,
              payload: { n: i },
            }),
          }),
        ),
      ),
    );
    const seqs = appends.map((a) => a.aggregateSeq).sort((a, b) => a - b);
    // Five init events (1..5) precede the five concurrent appends (6..10).
    expect(seqs).toEqual([6, 7, 8, 9, 10]);
  });

  it("a stale retry recomputes against the live version and succeeds", async () => {
    const userId = newUserId();
    await initUser(db, userId);

    // Winner moves 1 -> 2.
    await db.manager.runAsUser(userId, async (tx) => {
      const s = await tx.states.findOwned(userId);
      const r = await tx.states.saveStateIfVersionMatches(
        userId,
        1,
        s.transition(1, { energy: 0.5 }),
      );
      expect(r.outcome).toBe("saved");
    });

    // Loser retries: reload, recompute, write against version 2.
    const retried = await db.manager.runAsUser(userId, async (tx) => {
      const s = await tx.states.findOwned(userId);
      return tx.states.saveStateIfVersionMatches(
        userId,
        s.stateVersion,
        s.transition(s.stateVersion, { energy: 0.6 }),
      );
    });
    expect(retried.outcome).toBe("saved");
    if (retried.outcome === "saved") {
      expect(retried.state.stateVersion).toBe(3);
      expect(retried.state.energy).toBeCloseTo(0.6, 4);
    }
  });
});
