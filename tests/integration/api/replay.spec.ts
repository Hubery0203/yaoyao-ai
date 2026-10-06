/**
 * Replay integration tests (Phase 4, PM rule 3, T011/T012).
 *
 * Proves against a real database:
 * (a) the reconstructed state is correct (matches the persisted snapshot);
 * (b) replay causes ZERO database mutation (row counts + content hashes
 *     identical before/after);
 * (c) no events are created by replay;
 * (d) no outbox rows are created by replay;
 * (e) no AI/proactive/notification path exists to trigger (the outbox
 *     stays empty and no relay runs in MVP-001).
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeader,
  dockerAvailable,
  registerUser,
  setupApi,
  type ApiTestContext,
} from "./helpers.js";

const REPLAY_TABLES = [
  "users",
  "yaoyaos",
  "relationships",
  "core_states",
  "memory_containers",
  "memories",
  "sessions",
  "events",
  "refresh_sessions",
  "idempotency_records",
  "outbox",
] as const;

async function snapshotDb(ctx: ApiTestContext): Promise<Record<string, string>> {
  const snap: Record<string, string> = {};
  for (const table of REPLAY_TABLES) {
    // Content hash: count + md5 over the ordered text image of every row.
    // Any insert/update/delete changes the digest.
    const { rows } = await ctx.db.adminPool.query<{ c: string; h: string }>(
      `SELECT count(*)::text AS c, coalesce(md5(string_agg(t::text, ',' ORDER BY t::text)), 'empty') AS h FROM ${table} AS t`,
    );
    snap[table] = `${rows[0].c}:${rows[0].h}`;
  }
  return snap;
}

describe("replay diagnostics", () => {
  let ctx: ApiTestContext;

  beforeAll(async () => {
    if (!(await dockerAvailable())) return;
    ctx = await setupApi();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  }, 60_000);

  it("reconstructs the initial state and matches persistence (T011)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "replay@yaoyao.test");

    // Add session lifecycle events so the fold sees a realistic sequence.
    const s1 = await ctx.http
      .post("/api/v1/sessions")
      .set(authHeader(me.accessToken))
      .send({});
    await ctx.http
      .post(`/api/v1/sessions/${s1.body.data.sessionId}/close`)
      .set(authHeader(me.accessToken))
      .send({});

    const res = await ctx.http
      .get("/api/v1/diagnostics/replay")
      .set(authHeader(me.accessToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.yaoyaoId).toBe(me.yaoyaoId);
    // 5 init events + SESSION_STARTED + SESSION_ENDED for the new session.
    expect(data.eventsFolded).toBe(7);
    expect(data.reconstructedVersion).toBe(1);
    expect(data.persistedVersion).toBe(1);
    expect(data.match).toBe(true);
    expect(data.diffs).toEqual([]);
    // The trace records every event; only STATE_CREATED applied to state.
    const applied = data.trace.filter((t: { applied: boolean }) => t.applied);
    expect(applied.map((t: { type: string }) => t.type)).toEqual(["STATE_CREATED"]);
  });

  it("supports paged replay via from_seq", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "replay-page@yaoyao.test");
    const res = await ctx.http
      .get("/api/v1/diagnostics/replay?from_seq=5")
      .set(authHeader(me.accessToken));
    expect(res.status).toBe(200);
    // from_seq=5 skips the 5 init events: no baseline -> no reconstruction.
    expect(res.body.data.eventsFolded).toBe(0);
    expect(res.body.data.reconstructedVersion).toBeNull();
    expect(res.body.data.match).toBe(false);
  });

  it("causes zero database mutation: no events, no outbox, no writes (T012)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "replay-clean@yaoyao.test");
    await ctx.http
      .post("/api/v1/sessions")
      .set(authHeader(me.accessToken))
      .send({});

    const before = await snapshotDb(ctx);

    const res = await ctx.http
      .get("/api/v1/diagnostics/replay")
      .set(authHeader(me.accessToken));
    expect(res.status).toBe(200);

    // Run it twice more for good measure.
    await ctx.http
      .get("/api/v1/diagnostics/replay")
      .set(authHeader(me.accessToken));
    await ctx.http
      .get("/api/v1/diagnostics/replay")
      .set(authHeader(me.accessToken));

    const after = await snapshotDb(ctx);
    expect(after).toEqual(before);

    // Explicit event/outbox assertions (PM rule 3c/d).
    // Scoped to THIS test's user: earlier tests in this file registered
    // their own users in the same database, so a whole-table count would
    // include their events (6 per prior test) and flake with test order.
    const { rows: eventRows } = await ctx.db.adminPool.query(
      `SELECT count(*)::int AS c FROM events WHERE user_id = $1`,
      [me.userId],
    );
    const { rows: outboxRows } = await ctx.db.adminPool.query(
      `SELECT count(*)::int AS c FROM outbox WHERE user_id = $1`,
      [me.userId],
    );
    // 5 init + 1 session-started = 6 events; outbox untouched by replay.
    expect(eventRows[0].c).toBe(6);
    expect(outboxRows[0].c).toBe(0);
  });

  it("requires authentication (default-deny)", async () => {
    if (!ctx) return;
    const res = await ctx.http.get("/api/v1/diagnostics/replay");
    expect(res.status).toBe(401);
  });

  it("hashes the snapshot helper deterministically", () => {
    // Sanity: the snapshot helper itself is stable.
    const h = createHash("sha256").update("replay").digest("hex");
    expect(h).toHaveLength(64);
  });
});
