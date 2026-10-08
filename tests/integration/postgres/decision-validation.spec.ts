/**
 * MVP-002F integration tests — Decision + Response Validation persistence safety.
 *
 * F22 Replay zero side effects (decision/validation leave no writes)
 * F23 Concurrent conversation safety (two turns, CAS serializes state)
 * F24 Restart continuity (decision-relevant state survives reconnect)
 *
 * Skipped without Docker (runs in GitHub CI).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTransactionManager } from "@yaoyao/infrastructure";
import {
  applyEmotionProposal,
  initializeYaoYao,
  replayDiagnostics,
  type PersistenceTransaction,
} from "@yaoyao/application";
import { DecisionEngine, validateResponse } from "@yaoyao/runtime";
import { asProposal } from "@yaoyao/application";
import { newUserId } from "@yaoyao/domain";
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
        email: `dec-${userId}@example.com`,
        passwordHash: "h",
      }),
  );
  return { userId, yaoyaoId: init.yaoyaoId };
}

const engine = new DecisionEngine();

function baseEmotion() {
  return {
    happiness: 0.6, sadness: 0.05, anger: 0, hurt: 0,
    affection: 0.7, jealousy: 0, loneliness: 0.1,
    excitement: 0.4, calm: 0.6,
  };
}

describe.skipIf(!HAS_DOCKER)("MVP-002F: Decision + Validation persistence (PostgreSQL)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("F22: replay has zero persistent side effects", async () => {
    const owner = await setupUser(db);

    // A full turn: decide → (mock) generate → validate → emotion write-back.
    const { decision } = engine.decide({
      userId: String(owner.userId),
      yaoyaoId: String(owner.yaoyaoId),
      currentInput: "我今天好累",
      situation: { intent: "chat", urgency: "low", taskNature: "chat" },
      emotion: baseEmotion(),
      personaTone: "warm",
      recentConversation: [],
      traceId: "f22",
    });
    const validation = validateResponse({
      proposal: {
        response: asProposal("宝贝辛苦了，快去休息一下呀。"),
        emotion_signal: asProposal({}),
        memory_candidates: asProposal([]),
        relationship_signal: asProposal({}),
        behavior: asProposal({}),
      },
      decision,
      userInput: "我今天好累",
      recentConversation: [],
    });
    expect(validation.passed).toBe(true);

    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, {
        userId: owner.userId,
        yaoyaoId: owner.yaoyaoId,
        deltas: { affection: 0.05 } as never,
        expectedVersion: v0,
        traceId: "f22",
      }),
    );

    const eventsBefore = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    const stateBefore = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );

    // Replay: read-only.
    await db.manager.runAsUser(owner.userId, (tx) =>
      replayDiagnostics(tx, { userId: owner.userId, yaoyaoId: owner.yaoyaoId }),
    );

    const eventsAfter = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.events.readOwnedAfter(owner.userId, owner.yaoyaoId, 0),
    );
    const stateAfter = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(eventsAfter.length).toBe(eventsBefore.length);
    expect(stateAfter.stateVersion).toBe(stateBefore.stateVersion);
  });

  it("F23: concurrent conversations — CAS serializes, no lost update", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;

    // Two concurrent turns both decide from v0.
    const [r1, r2] = await Promise.all([
      db.manager.runAsUser(owner.userId, (tx) =>
        applyEmotionProposal(tx, {
          userId: owner.userId,
          yaoyaoId: owner.yaoyaoId,
          deltas: { hurt: 0.1 } as never,
          expectedVersion: v0,
          traceId: "f23-a",
        }),
      ),
      db.manager.runAsUser(owner.userId, (tx) =>
        applyEmotionProposal(tx, {
          userId: owner.userId,
          yaoyaoId: owner.yaoyaoId,
          deltas: { hurt: 0.2 } as never,
          expectedVersion: v0,
          traceId: "f23-b",
        }),
      ),
    ]);
    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(["applied", "conflict"]);

    // The winner's delta is exactly applied — no partial/merged state.
    const after = await db.manager.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(after.stateVersion).toBe(v0 + 1);
    const hurt = after.emotion.get("hurt");
    expect(hurt === 0.1 || hurt === 0.2).toBe(true);
  });

  it("F24: restart continuity — decision-relevant state survives", async () => {
    const owner = await setupUser(db);
    const v0 = (
      await db.manager.runAsUser(owner.userId, (tx) =>
        tx.states.findOwned(owner.userId),
      )
    ).stateVersion;
    await db.manager.runAsUser(owner.userId, (tx) =>
      applyEmotionProposal(tx, {
        userId: owner.userId,
        yaoyaoId: owner.yaoyaoId,
        deltas: { hurt: 0.25 } as never,
        expectedVersion: v0,
        traceId: "f24",
      }),
    );

    // Simulate restart: fresh manager, same pool.
    const fresh = new PostgresTransactionManager(db.appPool);
    const reloaded = await fresh.runAsUser(owner.userId, (tx) =>
      tx.states.findOwned(owner.userId),
    );
    expect(reloaded.emotion.get("hurt")).toBeCloseTo(0.25);

    // The next turn's decision sees the persisted hurt.
    const { decision } = engine.decide({
      userId: String(owner.userId),
      yaoyaoId: String(owner.yaoyaoId),
      currentInput: "你还在生气吗",
      situation: { intent: "chat", urgency: "low", taskNature: "chat" },
      emotion: Object.fromEntries(
        ["happiness","sadness","anger","hurt","affection","jealousy","loneliness","excitement","calm"].map(
          (d) => [d, reloaded.emotion.get(d as never)],
        ),
      ),
      personaTone: "warm",
      recentConversation: [],
      traceId: "f24b",
    });
    // hurt 0.25 < 0.6 threshold → not express_hurt; decision is stable.
    expect(decision.primaryIntent).not.toBe("express_hurt");
  });
});
