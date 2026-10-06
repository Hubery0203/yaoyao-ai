/**
 * Event append-only proof — the application role cannot mutate history
 * through any SQL path: revoked grants (layer 1) and the immutable
 * trigger (layer 2) both reject the write, and the original bytes stay
 * intact. The EventStore port exposes no update/delete method at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initializeYaoYao,
  type PersistenceTransaction,
} from "@yaoyao/application";
import { newUserId, DomainEvent, type UserId } from "@yaoyao/domain";
import {
  dockerAvailable,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

describe.skipIf(!HAS_DOCKER)("events are append-only", () => {
  let db: TestDatabase;
  let userId: UserId;
  let eventId: string;
  let before: Record<string, unknown>;

  beforeAll(async () => {
    db = await setupDatabase();
    userId = newUserId();
    const result = await db.manager.runAsUser(userId, (tx: PersistenceTransaction) =>
      initializeYaoYao(tx, {
        userId,
        email: `ao-${userId}@example.com`,
        passwordHash: "h",
      }),
    );
    eventId = result.events[0].event.eventId as string;

    const client = await db.appPool.connect();
    try {
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userId as string,
      ]);
      const { rows } = await client.query(
        `SELECT event_id, type, payload, aggregate_seq FROM events WHERE event_id = $1`,
        [eventId],
      );
      before = rows[0] as Record<string, unknown>;
    } finally {
      client.release();
    }
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("rejects UPDATE as the app role", async () => {
    const client = await db.appPool.connect();
    try {
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userId as string,
      ]);
      await expect(
        client.query(`UPDATE events SET payload = '{"hacked":true}' WHERE event_id = $1`, [
          eventId,
        ]),
      ).rejects.toThrow(/append-only|permission denied/i);
    } finally {
      client.release();
    }
  });

  it("rejects DELETE as the app role", async () => {
    const client = await db.appPool.connect();
    try {
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userId as string,
      ]);
      await expect(
        client.query(`DELETE FROM events WHERE event_id = $1`, [eventId]),
      ).rejects.toThrow(/append-only|permission denied/i);
    } finally {
      client.release();
    }
  });

  it("rejects UPDATE even as superuser (trigger is role-independent)", async () => {
    await expect(
      db.adminPool.query(
        `UPDATE events SET payload = '{"hacked":true}' WHERE event_id = $1`,
        [eventId],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("leaves the original event bytes untouched", async () => {
    const { rows } = await db.adminPool.query(
      `SELECT event_id, type, payload, aggregate_seq FROM events WHERE event_id = $1`,
      [eventId],
    );
    expect(rows[0]).toEqual(before);
  });

  it("still appends new events normally", async () => {
    // History grows by appending; the rejected mutations above changed nothing.
    const yaoyaoId = (
      await db.manager.runAsUser(userId, (tx) => tx.aggregates.loadOwned(userId))
    ).yaoyaoId;
    const appended = await db.manager.runAsUser(userId, (tx) =>
      tx.events.append({
        event: DomainEvent.create({
          type: "STATE_CHANGED",
          actor: "YAOYAO",
          userId,
          yaoyaoId,
          payload: { note: "after rejected mutations" },
        }),
      }),
    );
    expect(appended.aggregateSeq).toBe(6);
    const replay = await db.manager.runAsUser(userId, (tx) =>
      tx.events.readOwnedAfter(userId, yaoyaoId, 0),
    );
    expect(replay).toHaveLength(6);
  });
});
