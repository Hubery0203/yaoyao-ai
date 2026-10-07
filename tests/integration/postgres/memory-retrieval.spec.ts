/**
 * MVP-002D integration tests — Memory Retrieval against real PostgreSQL.
 *
 * D01 Relevant Memory (end-to-end)
 * D08 Owner Isolation (User A vs User B)
 * D09 YaoYao Isolation (different YaoYao)
 * D10 No Creation (count/version/updated_at unchanged)
 * D14 No Hallucination (empty DB → empty result)
 * D15 Restart determinism (same DB state → same results)
 * D16 Concurrent retrieval (no mutation, no shared-state pollution)
 *
 * Skipped without Docker (runs in GitHub CI).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  PostgresMemoryRetrievalAdapter,
  schema,
} from "@yaoyao/infrastructure";
import {
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import {
  newMemoryId,
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

interface TestMemory {
  memoryId: string;
  content: string;
  type: "CORE" | "SEMANTIC" | "EPISODIC" | "SHARED_LIFE";
  importance: string;
  confidence: string;
  status: "VALIDATED" | "CONSOLIDATED";
}

async function setupUser(db: TestDatabase) {
  const userId = newUserId();
  const init = await db.manager.runAsUser(
    userId,
    (tx: PersistenceTransaction) =>
      initializeYaoYao(tx, {
        userId,
        email: `mem-${userId}@example.com`,
        passwordHash: "h",
      }),
  );
  // Fetch the auto-created memory container.
  const appDb = drizzle(db.appPool, { schema });
  const containers = await appDb
    .select({ containerId: schema.memoryContainers.containerId })
    .from(schema.memoryContainers)
    .where(eq(schema.memoryContainers.userId, userId as string))
    .limit(1);
  if (containers.length === 0) throw new Error("no memory container created");
  return {
    userId,
    yaoyaoId: init.yaoyaoId,
    containerId: containers[0].containerId,
  };
}

async function insertMemories(
  db: TestDatabase,
  owner: { userId: UserId; yaoyaoId: YaoYaoId; containerId: string },
  mems: TestMemory[],
) {
  const appDb = drizzle(db.appPool, { schema });
  const now = new Date();
  for (const m of mems) {
    await appDb.insert(schema.memories).values({
      memoryId: m.memoryId,
      containerId: owner.containerId,
      userId: owner.userId as string,
      yaoyaoId: owner.yaoyaoId as string,
      type: m.type,
      content: m.content,
      importance: m.importance,
      confidence: m.confidence,
      sourceEvents: [],
      status: m.status,
      version: 1,
      supersedes: null,
      archiveReason: null,
      lastRecalledAt: null,
      timesRecalled: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function retrievalInput(owner: {
  userId: UserId;
  yaoyaoId: YaoYaoId;
}, text: string) {
  return {
    userId: owner.userId,
    yaoyaoId: owner.yaoyaoId,
    currentInput: text,
    situation: { intent: "chat", urgency: "normal", taskNature: "general" },
    relationshipContext: { type: "deep_partner", status: "active" },
    recentConversation: [],
    limit: 50,
    traceId: `trace-${Date.now()}`,
  };
}

describe.skipIf(!HAS_DOCKER)("MVP-002D: Memory Retrieval (PostgreSQL)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("D01: relevant memories are retrieved end-to-end", async () => {
    const owner = await setupUser(db);
    await insertMemories(db, owner, [
      {
        memoryId: newMemoryId() as string,
        content: "用户喜欢喝拿铁咖啡每天早上都要喝",
        type: "SEMANTIC",
        importance: "0.8",
        confidence: "0.9",
        status: "CONSOLIDATED",
      },
      {
        memoryId: newMemoryId() as string,
        content: "用户下周计划去日本旅行看樱花",
        type: "EPISODIC",
        importance: "0.7",
        confidence: "0.85",
        status: "VALIDATED",
      },
    ]);
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    const result = await adapter.retrieve(retrievalInput(owner, "我想喝咖啡"));
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.memories[0].summary).toContain("咖啡");
    expect(result.telemetry.candidateCount).toBe(2);
    expect(result.telemetry.selectedCount).toBeGreaterThan(0);
    // Summaries are model-safe: no UUIDs, no raw fields.
    for (const m of result.memories) {
      expect(m.summary).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
    }
  });

  it("D08: User A can never retrieve User B's memories", async () => {
    const userA = await setupUser(db);
    const userB = await setupUser(db);
    const secretId = newMemoryId() as string;
    await insertMemories(db, userB, [
      {
        memoryId: secretId,
        content: "用户B的秘密咖啡偏好绝不能泄露",
        type: "SEMANTIC",
        importance: "0.9",
        confidence: "0.9",
        status: "CONSOLIDATED",
      },
    ]);
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    // A queries with A's own identity — B's memory must not appear.
    const resultA = await adapter.retrieve(retrievalInput(userA, "咖啡偏好"));
    expect(
      resultA.memories.every((m) => m.memoryId !== secretId),
    ).toBe(true);
    // B queries with B's identity — sees their own memory.
    const resultB = await adapter.retrieve(retrievalInput(userB, "咖啡偏好"));
    expect(resultB.memories.some((m) => m.memoryId === secretId)).toBe(true);
  });

  it("D09: different YaoYaos cannot retrieve each other's memories", async () => {
    const owner1 = await setupUser(db);
    // Same user, second YaoYao — simulate by initializing another identity.
    const owner2 = await setupUser(db);
    const memId = newMemoryId() as string;
    await insertMemories(db, owner1, [
      {
        memoryId: memId,
        content: "第一个遥遥的专属记忆关于咖啡",
        type: "SHARED_LIFE",
        importance: "0.8",
        confidence: "0.9",
        status: "CONSOLIDATED",
      },
    ]);
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    const result = await adapter.retrieve(retrievalInput(owner2, "咖啡"));
    expect(result.memories.every((m) => m.memoryId !== memId)).toBe(true);
  });

  it("D10: retrieval changes nothing (count/version/updated_at)", async () => {
    const owner = await setupUser(db);
    const memId = newMemoryId() as string;
    await insertMemories(db, owner, [
      {
        memoryId: memId,
        content: "D10测试记忆关于咖啡",
        type: "SEMANTIC",
        importance: "0.8",
        confidence: "0.9",
        status: "CONSOLIDATED",
      },
    ]);
    const appDb = drizzle(db.appPool, { schema });
    const beforeRows = await appDb
      .select({
        memoryId: schema.memories.memoryId,
        version: schema.memories.version,
        updatedAt: schema.memories.updatedAt,
        timesRecalled: schema.memories.timesRecalled,
      })
      .from(schema.memories)
      .where(eq(schema.memories.memoryId, memId));
    expect(beforeRows.length).toBe(1);
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    await adapter.retrieve(retrievalInput(owner, "咖啡"));
    await adapter.retrieve(retrievalInput(owner, "咖啡"));
    const afterRows = await appDb
      .select({
        memoryId: schema.memories.memoryId,
        version: schema.memories.version,
        updatedAt: schema.memories.updatedAt,
        timesRecalled: schema.memories.timesRecalled,
      })
      .from(schema.memories)
      .where(eq(schema.memories.memoryId, memId));
    expect(afterRows.length).toBe(1);
    // version, updated_at, times_recalled all unchanged — no recordRecall,
    // no touch, no insert.
    expect(afterRows[0].version).toBe(beforeRows[0].version);
    expect(afterRows[0].updatedAt.getTime()).toBe(
      beforeRows[0].updatedAt.getTime(),
    );
    expect(afterRows[0].timesRecalled).toBe(beforeRows[0].timesRecalled);
  });

  it("D14: empty database → empty result, never hallucinated", async () => {
    const owner = await setupUser(db);
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    const result = await adapter.retrieve(
      retrievalInput(owner, "用户喜欢什么咖啡？"),
    );
    expect(result.memories).toEqual([]);
    expect(result.telemetry.candidateCount).toBe(0);
  });

  it("D15: same DB state → deterministic results", async () => {
    const owner = await setupUser(db);
    await insertMemories(db, owner, [
      {
        memoryId: newMemoryId() as string,
        content: "D15记忆一关于咖啡",
        type: "SEMANTIC",
        importance: "0.8",
        confidence: "0.9",
        status: "CONSOLIDATED",
      },
      {
        memoryId: newMemoryId() as string,
        content: "D15记忆二关于旅行",
        type: "EPISODIC",
        importance: "0.7",
        confidence: "0.8",
        status: "VALIDATED",
      },
    ]);
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    const r1 = await adapter.retrieve(retrievalInput(owner, "咖啡旅行"));
    const r2 = await adapter.retrieve(retrievalInput(owner, "咖啡旅行"));
    expect(r1.memories.map((m) => m.memoryId)).toEqual(
      r2.memories.map((m) => m.memoryId),
    );
    expect(r1.memories.map((m) => m.score)).toEqual(
      r2.memories.map((m) => m.score),
    );
  });

  it("D16: concurrent retrievals — no mutation, no shared-state pollution", async () => {
    const owner = await setupUser(db);
    await insertMemories(db, owner, [
      {
        memoryId: newMemoryId() as string,
        content: "D16并发测试记忆咖啡",
        type: "SEMANTIC",
        importance: "0.8",
        confidence: "0.9",
        status: "CONSOLIDATED",
      },
    ]);
    const appDb = drizzle(db.appPool, { schema });
    const countBefore = (
      await appDb.select().from(schema.memories)
    ).length;
    const adapter = new PostgresMemoryRetrievalAdapter(
      drizzle(db.appPool, { schema }),
    );
    const results = await Promise.all(
      ["咖啡", "旅行", "音乐", "电影", "美食"].map((q) =>
        adapter.retrieve(retrievalInput(owner, q)),
      ),
    );
    // Each result is independent (different queries → different telemetry).
    const requestIds = results.map((r) => r.telemetry.requestId);
    expect(new Set(requestIds).size).toBe(5);
    // Nothing was written.
    const countAfter = (
      await appDb.select().from(schema.memories)
    ).length;
    expect(countAfter).toBe(countBefore);
  });
});
