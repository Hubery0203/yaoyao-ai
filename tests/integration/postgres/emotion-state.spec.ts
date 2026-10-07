/**
 * MVP-002E integration tests — Emotion State Write-back against real PostgreSQL.
 *
 * E10 State CAS success
 * E11 State CAS conflict (B must not overwrite A)
 * E12 STATE_CHANGED Event (append-only, correct sequence/causation)
 * E13 Transaction atomicity (state + event commit together)
 * E14 Restart persistence (state survives pool restart)
 * E15 Owner isolation (User A cannot write User B's state)
 * E16 Concurrent emotion updates (one wins, one gets conflict)
 * E20 Replay has zero persistent side effects
 *
 * Skipped without Docker (runs in GitHub CI).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresTransactionManager,
} from "@yaoyao/infrastructure";
import {
  applyEmotionProposal,
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import {
  newUserId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import {
  dockerAvailable,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

async function setupUser(db: TestDatabase) {
  const userId = newUserId();
  const init = await db.manager.runAsUser(
    userId,
    (tx: PersistenceTransaction) =>
      initializeYaoYao(tx, {
        userId,
        email: `emo-${userId}@example.com`,
        passwordHash: "h",
      }),
  );
  return { userId, yaoyaoId: init.yaoyaoId };
}

function writebackInput(owner: { userId: UserId; yaoyaoId: YaoYaoId }, version: number, deltas: Record<string, number> = { hurt: 0.1 }) {
  return {
    userId: owner.userId,
    yaoyaoId: owner.yaoyaoId,
    deltas: deltas as never,
    expectedVersion: version,
    traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

describe.skipIf(!HAS_DOCKER)("MVP-002E: Emotion State Write-back (PostgreSQL)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("E10: valid proposal → CAS success, version bumps", async () => {
    const owner = await setupUser(db);
    const before = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    const result = await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, writebackInput(owner, before.stateVersion, { hurt: 0.15 })),
    );
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.newVersion).toBe(before.stateVersion + 1);
      expect(result.newEmotion["hurt"]).toBeCloseTo(
        before.emotion.get("hurt") + 0.15,
      );
      expect(result.eventId).toBeTruthy();
    }
  });

  it("E11: CAS conflict — B cannot overwrite A", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    // A and B both load v0.
    const resultA = await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, writebackInput(owner, v0, { hurt: 0.1 })),
    );
    expect(resultA.outcome).toBe("applied");
    // B still holds v0 → conflict, no silent overwrite.
    const resultB = await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, writebackInput(owner, v0, { anger: 0.1 })),
    );
    expect(resultB.outcome).toBe("conflict");
    if (resultB.outcome === "conflict") {
      expect(resultB.current).toBe(v0 + 1);
    }
    // A's value survived; B's delta was NOT applied.
    const after = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(after.emotion.get("anger")).toBeCloseTo(0);
  });

  it("E12: STATE_CHANGED event is append-only with causation/correlation", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    const traceId = `trace-e12-${Date.now()}`;
    const result = await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, {
        ...writebackInput(owner, v0, { affection: 0.1 }),
        traceId,
      }),
    );
    expect(result.outcome).toBe("applied");
    // Read back the event.
    const events = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    const stateChanged = events.filter((e) => e.event.type === "STATE_CHANGED");
    expect(stateChanged.length).toBeGreaterThan(0);
    const last = stateChanged[stateChanged.length - 1];
    expect(last.event.correlationId).toBe(traceId);
    expect(last.aggregateSeq).toBeGreaterThan(0);
    // Payload follows the replay contract.
    const payload = last.event.payload as Record<string, unknown>;
    expect(payload["expectedVersion"]).toBe(v0);
    expect(
      ((payload["changes"] as Record<string, unknown>)["emotion"] as Record<string, number>)["affection"],
    ).toBeCloseTo(0.1);
  });

  it("E13: transaction atomicity — state + event commit together", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    const eventsBefore = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, writebackInput(owner, v0, { calm: 0.1 })),
    );
    const after = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    const eventsAfter = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    expect(after.stateVersion).toBe(v0 + 1);
    expect(eventsAfter.length).toBe(eventsBefore.length + 1);
  });

  it("E14: restart persistence — state survives reconnect", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, writebackInput(owner, v0, { happiness: 0.2 })),
    );
    // Simulate restart: new manager over the same pool.
    const fresh = new PostgresTransactionManager(db.appPool);
    const reloaded = await fresh.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(reloaded.stateVersion).toBe(v0 + 1);
    expect(reloaded.emotion.get("happiness")).toBeCloseTo(0.8);
  });

  it("E15: owner isolation — A cannot write B's state", async () => {
    const userA = await setupUser(db);
    const userB = await setupUser(db);
    const bBefore = await db.manager.runAsUser(userB.userId, (tx) =>
      tx.states.findOwned(userB.userId),
    );
    // A attempts to write with B's userId in the input but A's RLS context.
    // runAsUser pins app.user_id = A; B's row is invisible → findOwned
    // throws (or the CAS finds no row). Either way, B is untouched.
    let outcome: string;
    try {
      const result = await db.manager.runAsUser(userA.userId, (tx) =>
        applyEmotionProposal(
          tx,
          writebackInput(
            { userId: userB.userId, yaoyaoId: userB.yaoyaoId },
            bBefore.stateVersion,
            { hurt: 0.5 },
          ),
        ),
      );
      outcome = result.outcome;
    } catch {
      outcome = "blocked";
    }
    const bAfter = await db.manager.runAsUser(userB.userId, (tx) =>
      tx.states.findOwned(userB.userId),
    );
    expect(bAfter.stateVersion).toBe(bBefore.stateVersion);
    expect(bAfter.emotion.get("hurt")).toBeCloseTo(
      bBefore.emotion.get("hurt"),
    );
    expect(outcome).not.toBe("applied");
  });

  it("E16: concurrent updates — one wins, one gets conflict", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    const [r1, r2] = await Promise.all([
      db.manager.runAsUser(owner.userId, (tx) =>
        applyEmotionProposal(tx, writebackInput(owner, v0, { hurt: 0.1 })),
      ),
      db.manager.runAsUser(owner.userId, (tx) =>
        applyEmotionProposal(tx, writebackInput(owner, v0, { hurt: 0.2 })),
      ),
    ]);
    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(["applied", "conflict"]);
    const after = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(after.stateVersion).toBe(v0 + 1);
  });

  it("E20: replay has zero persistent side effects", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, writebackInput(owner, v0, { hurt: 0.12 })),
    );
    const eventsBefore = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    const stateBefore = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    // Replay: read-only rebuild from events (Phase 4 replay use case).
    const { replayDiagnostics } = await import("@yaoyao/application");
    await db.manager.runAsUser(owner.userId, async (tx) => {
      await replayDiagnostics(tx, {
        userId: owner.userId,
        yaoyaoId: owner.yaoyaoId,
      });
    });
    const eventsAfter = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    const stateAfter = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(eventsAfter.length).toBe(eventsBefore.length);
    expect(stateAfter.stateVersion).toBe(stateBefore.stateVersion);
  });
});
