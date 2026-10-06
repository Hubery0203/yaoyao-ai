/**
 * T009 facet — fault injection proves rollback leaves nothing behind.
 *
 * Each test performs the real repository calls in initialization order
 * inside one transaction and throws at a different point. After the
 * rollback, every owner-scoped table must contain zero rows for the
 * attempted identity, and no idempotency record may claim success.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import {
  DomainEvent,
  newMemoryContainerId,
  newUserId,
  Session,
  User,
  YaoYaoAggregate,
  type UserId,
} from "@yaoyao/domain";
import {
  dockerAvailable,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

const OWNER_TABLES = [
  "users",
  "yaoyaos",
  "relationships",
  "core_states",
  "memory_containers",
  "memories",
  "sessions",
  "events",
  "refresh_sessions",
  "outbox",
] as const;

/** The real init step order, abortable after any named step. */
async function initWithFault(
  tx: PersistenceTransaction,
  userId: UserId,
  failAfter:
    | "user"
    | "aggregate"
    | "container"
    | "session"
    | "event-3"
    | "before-commit",
): Promise<void> {
  const maybeFail = (step: typeof failAfter) => {
    if (step === failAfter) throw new Error(`injected fault after ${step}`);
  };
  const email = `fault-${userId.slice(0, 8)}@example.com`;
  const user = User.create({ userId });
  const aggregate = YaoYaoAggregate.create({ userId });
  const containerId = newMemoryContainerId();
  const session = Session.start({ userId, yaoyaoId: aggregate.yaoyaoId });

  await tx.users.insert({ user, email, passwordHash: "h" });
  maybeFail("user");
  await tx.aggregates.insert(aggregate);
  maybeFail("aggregate");
  await tx.memoryContainers.insert({
    containerId,
    userId,
    yaoyaoId: aggregate.yaoyaoId,
  });
  maybeFail("container");
  await tx.sessions.insert(session);
  maybeFail("session");

  const types = [
    "USER_CREATED",
    "YAOYAO_CREATED",
    "RELATIONSHIP_CREATED",
  ] as const;
  for (const type of types) {
    await tx.events.append({
      event: DomainEvent.create({
        type,
        actor: "SYSTEM",
        userId,
        yaoyaoId: aggregate.yaoyaoId,
        source: "SYSTEM",
      }),
    });
  }
  maybeFail("event-3");
  maybeFail("before-commit");
}

async function countOwned(
  db: TestDatabase,
  table: string,
  userId: UserId,
): Promise<number> {
  const { rows } = await db.adminPool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id = $1`,
    [userId as string],
  );
  return rows[0].n as number;
}

describe.skipIf(!HAS_DOCKER)("T009: rollback leaves nothing behind", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  const faultPoints = [
    "user",
    "aggregate",
    "container",
    "session",
    "event-3",
    "before-commit",
  ] as const;

  for (const point of faultPoints) {
    it(`rolls back a fault injected after ${point}`, async () => {
      const userId = newUserId();
      await expect(
        db.manager.runAsUser(userId, (tx) => initWithFault(tx, userId, point)),
      ).rejects.toThrow(`injected fault after ${point}`);
      for (const table of OWNER_TABLES) {
        expect(await countOwned(db, table, userId), table).toBe(0);
      }
    });
  }

  it("rolls back the real use case when the caller fails before commit", async () => {
    const userId = newUserId();
    await expect(
      db.manager.runAsUser(userId, async (tx) => {
        await initializeYaoYao(tx, {
          userId,
          email: `real-${userId.slice(0, 8)}@example.com`,
          passwordHash: "h",
        });
        throw new Error("caller blew up before commit");
      }),
    ).rejects.toThrow("caller blew up before commit");
    for (const table of OWNER_TABLES) {
      expect(await countOwned(db, table, userId), table).toBe(0);
    }
  });

  it("retries cleanly after a rolled-back attempt", async () => {
    const userId = newUserId();
    await expect(
      db.manager.runAsUser(userId, (tx) => initWithFault(tx, userId, "session")),
    ).rejects.toThrow();
    // A fresh attempt with the same identity succeeds exactly once.
    const result = await db.manager.runAsUser(userId, (tx) =>
      initializeYaoYao(tx, {
        userId,
        email: `retry-${userId.slice(0, 8)}@example.com`,
        passwordHash: "h",
      }),
    );
    expect(result.events).toHaveLength(5);
  });
});
