/**
 * T001 facet — first initialization is atomic and complete.
 *
 * Runs the real initializeYaoYao use case through the real
 * PostgresTransactionManager against a real database: the full graph
 * (User → YaoYao → Relationship → State → Container → Session) plus
 * exactly five ordered init events commit once. Also covers the memory
 * repository round-trip and the idempotency duplicate paths.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EntityNotFoundError,
  IdempotencyKeyReusedError,
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import {
  Memory,
  newUserId,
  type EventId,
  type UserId,
} from "@yaoyao/domain";
import {
  dockerAvailable,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

async function initOnce(
  db: TestDatabase,
  userId: UserId,
  idempotency?: { key: string; requestBody: string },
) {
  return db.manager.runAsUser(userId, (tx: PersistenceTransaction) =>
    initializeYaoYao(tx, {
      userId,
      email: `u-${userId}@example.com`,
      passwordHash: "argon2id$test-hash",
      ...(idempotency
        ? {
            idempotency: {
              userScope: `user:${userId}`,
              operation: "initialize",
              key: idempotency.key,
              requestBody: idempotency.requestBody,
            },
          }
        : {}),
    }),
  );
}

describe.skipIf(!HAS_DOCKER)("T001: atomic first initialization", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("commits the full graph plus exactly five ordered init events", async () => {
    const userId = newUserId();
    const result = await initOnce(db, userId);
    expect(result.duplicate).toBe(false);
    expect(result.events).toHaveLength(5);

    const types = result.events.map((e) => e.event.type);
    expect(types).toEqual([
      "USER_CREATED",
      "YAOYAO_CREATED",
      "RELATIONSHIP_CREATED",
      "STATE_CREATED",
      "SESSION_STARTED",
    ]);
    expect(result.events.map((e) => e.aggregateSeq)).toEqual([1, 2, 3, 4, 5]);

    // The aggregate rehydrates through guarded composition.
    const aggregate = await db.manager.runAsUser(userId, (tx) =>
      tx.aggregates.loadOwned(userId),
    );
    expect(aggregate.yaoyaoId).toBe(result.yaoyaoId);
    expect(aggregate.yaoyao.identityKey).toBe("shen_zhiyao");
    expect(aggregate.relationship.type).toBe("deep_partner");
    expect(aggregate.state.stateVersion).toBe(1);

    // Replay from scratch returns the same five events in order.
    const replay = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, result.yaoyaoId, 0),
    );
    expect(replay.map((e) => e.aggregateSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("round-trips a memory through its lifecycle with owned provenance", async () => {
    const userId = newUserId();
    const result = await initOnce(db, userId);
    const sessionEvent = result.events.find((e) => e.event.type === "SESSION_STARTED")!;

    const memoryId = await db.manager.runAsUser(userId, async (tx) => {
      const container = await tx.memoryContainers.findOwned(userId);
      const memory = Memory.candidate({
        containerId: container.containerId,
        userId,
        yaoyaoId: result.yaoyaoId,
        type: "EPISODIC",
        content: "first initialization completed",
        sourceEvents: [sessionEvent.event.eventId as EventId],
      });
      await tx.memories.insert(memory);
      return memory.memoryId;
    });

    const consolidated = await db.manager.runAsUser(userId, async (tx) => {
      const m0 = await tx.memories.findOwned(userId, memoryId);
      expect(m0.status).toBe("CANDIDATE");
      const done = await tx.memories.save(userId, m0.validate().consolidate());
      expect(done.status).toBe("CONSOLIDATED");
      return done;
    });

    const { current } = consolidated.correct({ content: "init completed smoothly" });
    const corrected = await db.manager.runAsUser(userId, async (tx) => {
      const old = await tx.memories.findOwned(userId, memoryId);
      await tx.memories.save(userId, old.correct({ content: "init completed smoothly" }).superseded);
      await tx.memories.insert(current);
      const reloaded = await tx.memories.findOwned(userId, current.memoryId);
      expect(reloaded.status).toBe("CONSOLIDATED");
      expect(reloaded.version).toBe(2);
      expect(reloaded.supersedes).toBe(memoryId);
      const superseded = await tx.memories.findOwned(userId, memoryId);
      expect(superseded.status).toBe("CORRECTED");
      return reloaded;
    });
    expect(corrected.content).toBe("init completed smoothly");
  });

  it("rejects memory provenance outside the owner scope", async () => {
    const userId = newUserId();
    const otherId = newUserId();
    await initOnce(db, userId);
    const other = await initOnce(db, otherId);
    const foreignEvent = other.events[0].event.eventId;

    await expect(
      db.manager.runAsUser(userId, async (tx) => {
        const container = await tx.memoryContainers.findOwned(userId);
        await tx.memories.insert(
          Memory.candidate({
            containerId: container.containerId,
            userId,
            yaoyaoId: (await tx.aggregates.loadOwned(userId)).yaoyaoId,
            type: "SEMANTIC",
            content: "forged provenance",
            sourceEvents: [foreignEvent as EventId],
          }),
        );
      }),
    ).rejects.toThrow(/outside the owner scope/);
  });

  it("returns the stored result on idempotent retry (same key + body)", async () => {
    const userId = newUserId();
    const key = `init-key-${userId.slice(0, 8)}`;
    const body = JSON.stringify({ email: "idem@example.com" });
    const first = await initOnce(db, userId, { key, requestBody: body });
    expect(first.duplicate).toBe(false);

    const before = await db.adminPool.query(
      `SELECT COUNT(*)::int AS n FROM users`,
    );
    const second = await db.manager.runAsUser(userId, (tx) =>
      initializeYaoYao(tx, {
        userId: newUserId(), // different identity attempt, same key
        email: "idem2@example.com",
        passwordHash: "x",
        idempotency: {
          userScope: `user:${userId}`,
          operation: "initialize",
          key,
          requestBody: body,
        },
      }),
    );
    expect(second.duplicate).toBe(true);
    expect(second.userId).toBe(first.userId);
    const after = await db.adminPool.query(
      `SELECT COUNT(*)::int AS n FROM users`,
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("rejects the same idempotency key with a different body", async () => {
    const userId = newUserId();
    const key = `init-key2-${userId.slice(0, 8)}`;
    await initOnce(db, userId, { key, requestBody: '{"a":1}' });
    await expect(
      db.manager.runAsUser(userId, (tx) =>
        initializeYaoYao(tx, {
          userId,
          email: "x@example.com",
          passwordHash: "x",
          idempotency: {
            userScope: `user:${userId}`,
            operation: "initialize",
            key,
            requestBody: '{"a":2}',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  });

  it("duplicate initialization without idempotency fails on the unique owner", async () => {
    const userId = newUserId();
    await initOnce(db, userId);
    await expect(initOnce(db, userId)).rejects.toThrow();
    // The failed attempt left no second graph behind.
    const aggregate = await db.manager.runAsUser(userId, (tx) =>
      tx.aggregates.loadOwned(userId),
    );
    expect(aggregate.yaoyaoId).toBeDefined();
  });

  it("loading an unknown user reports not-found", async () => {
    const ghost = newUserId();
    await expect(
      db.manager.runAsUser(ghost, (tx) => tx.aggregates.loadOwned(ghost)),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });
});
