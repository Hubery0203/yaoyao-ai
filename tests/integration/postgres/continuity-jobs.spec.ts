import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeYaoYao, persistUserMessage, persistAssistantMessage } from "@yaoyao/application";
import { newUserId } from "@yaoyao/domain";
import { PostgresTransactionManager } from "@yaoyao/infrastructure";
import { dockerAvailable, setupDatabase, type TestDatabase } from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();
describe.skipIf(!HAS_DOCKER)("reconstructed 003A continuity durability", () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await setupDatabase(); }, 120_000);
  afterAll(async () => { await db?.teardown(); });

  async function turn() {
    const userId = newUserId();
    const init = await db.manager.runAsUser(userId, tx => initializeYaoYao(tx, {
      userId, email: `${userId}@example.com`, passwordHash: "h",
    }));
    const input = { userId, yaoyaoId: init.yaoyaoId, sessionId: String(init.sessionId),
      requestId: "request-1", traceId: "trace-1", text: "hello" };
    await db.manager.runAsUser(userId, tx => persistUserMessage(tx, input));
    return input;
  }

  it("concurrent Tx2 retries produce one event and job; rollback removes both", async () => {
    const input = await turn();
    await expect(db.manager.runAsUser(input.userId, async tx => {
      await persistAssistantMessage(tx, input);
      throw new Error("crash before commit");
    })).rejects.toThrow("crash before commit");
    const before = await db.adminPool.query("SELECT * FROM continuity_jobs WHERE user_id=$1", [input.userId]);
    expect(before.rows).toHaveLength(0);
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      db.manager.runAsUser(input.userId, tx => persistAssistantMessage(tx, input))));
    expect(new Set(results.map(r => r.eventId)).size).toBe(1);
    const jobs = await db.adminPool.query("SELECT * FROM continuity_jobs WHERE user_id=$1", [input.userId]);
    expect(jobs.rows).toHaveLength(1);
    const events = await db.adminPool.query("SELECT * FROM events WHERE user_id=$1 AND type='ASSISTANT_MESSAGE'", [input.userId]);
    expect(events.rows).toHaveLength(1);
  });

  it("survives manager restart, isolates owners and fences an expired lease", async () => {
    const input = await turn();
    await db.manager.runAsUser(input.userId, tx => persistAssistantMessage(tx, input));
    const restarted = new PostgresTransactionManager(db.appPool);
    const other = newUserId();
    expect(await restarted.runAsUser(other, tx => tx.continuity.claimNext(other, 60))).toBeNull();
    const claims = await Promise.all([1, 2].map(() => restarted.runAsUser(input.userId,
      tx => tx.continuity.claimNext(input.userId, 60))));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(c => c !== null)!;
    await db.adminPool.query("UPDATE continuity_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [first.jobId]);
    expect(await restarted.runAsUser(input.userId, tx => tx.continuity.complete(input.userId, first.jobId, first.leaseToken))).toBe(false);
    expect(await restarted.runAsUser(input.userId, tx => tx.continuity.sweepExpiredLeases(input.userId))).toBe(1);
    const second = await restarted.runAsUser(input.userId, tx => tx.continuity.claimNext(input.userId, 60));
    expect(second?.attempts).toBe(2);
    expect(second?.leaseToken).not.toBe(first.leaseToken);
    expect(await restarted.runAsUser(input.userId, tx => tx.continuity.complete(input.userId, first.jobId, first.leaseToken))).toBe(false);
    expect(await restarted.runAsUser(other, tx => tx.continuity.complete(other, second!.jobId, second!.leaseToken))).toBe(false);
    expect(await restarted.runAsUser(input.userId, tx => tx.continuity.complete(input.userId, second!.jobId, second!.leaseToken))).toBe(true);
    expect(await restarted.runAsUser(input.userId, tx => tx.continuity.claimNext(input.userId, 60))).toBeNull();
  });

  it("rejects orphan assistant messages atomically", async () => {
    const input = await turn();
    await expect(db.manager.runAsUser(input.userId, tx => persistAssistantMessage(tx,
      { ...input, requestId: "no-user-message" }))).rejects.toThrow("matching completed turn");
    const result = await db.adminPool.query("SELECT * FROM events WHERE user_id=$1 AND type='ASSISTANT_MESSAGE'", [input.userId]);
    expect(result.rows).toHaveLength(0);
  });
});
