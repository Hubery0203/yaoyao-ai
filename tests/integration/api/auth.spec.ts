/**
 * Auth flow integration tests (Phase 4).
 *
 * Full stack: HTTP -> use cases -> Postgres (Testcontainers). Covers
 * registration (T001 at HTTP level), login, refresh rotation with
 * reuse-theft detection, logout, and registration idempotency under the
 * server-defined public scope (PM rule 1).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeader,
  dockerAvailable,
  registerUser,
  setupApi,
  type ApiTestContext,
} from "./helpers.js";

describe("auth flows", () => {
  let ctx: ApiTestContext;

  beforeAll(async () => {
    if (!(await dockerAvailable())) return;
    ctx = await setupApi();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  }, 60_000);

  it("registers a user and initializes the full Core graph (T001)", async () => {
    if (!ctx) return;
    const res = await ctx.http
      .post("/api/v1/users")
      .send({ email: "t001@yaoyao.test", password: "correct-horse-123" });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBeTruthy();
    expect(res.body.data.yaoyaoId).toBeTruthy();
    expect(res.body.data.sessionId).toBeTruthy();
    expect(res.body.data.duplicate).toBe(false);

    // The Core is readable back through the API.
    const me = await registerUser(ctx, "t001b@yaoyao.test");
    const identity = await ctx.http
      .get("/api/v1/yaoyao")
      .set(authHeader(me.accessToken));
    expect(identity.status).toBe(200);
    expect(identity.body.data.yaoyaoId).toBe(me.yaoyaoId);
  });

  it("rejects duplicate email registration with 409 (T005: no duplicate Core)", async () => {
    if (!ctx) return;
    await ctx.http
      .post("/api/v1/users")
      .send({ email: "dup@yaoyao.test", password: "correct-horse-123" });
    const res = await ctx.http
      .post("/api/v1/users")
      .send({ email: "dup@yaoyao.test", password: "correct-horse-123" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_ENTITY");
  });

  it("honors Idempotency-Key on registration under the public scope (PM rule 1)", async () => {
    if (!ctx) return;
    const key = "reg-key-1";
    const first = await ctx.http
      .post("/api/v1/users")
      .set("Idempotency-Key", key)
      .send({ email: "idem@yaoyao.test", password: "correct-horse-123" });
    expect(first.status).toBe(201);
    expect(first.body.data.duplicate).toBe(false);

    const second = await ctx.http
      .post("/api/v1/users")
      .set("Idempotency-Key", key)
      .send({ email: "idem@yaoyao.test", password: "correct-horse-123" });
    expect(second.status).toBe(201);
    expect(second.body.data.duplicate).toBe(true);
    expect(second.body.data.userId).toBe(first.body.data.userId);

    // The scope recorded server-side is the constant, never client input.
    const { rows } = await ctx.db.adminPool.query<{ user_scope: string }>(
      `SELECT user_scope FROM idempotency_records WHERE operation = 'user-registration'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.user_scope).toBe("public:registration");
    }
  });

  it("rejects registration with a short password (400)", async () => {
    if (!ctx) return;
    const res = await ctx.http
      .post("/api/v1/users")
      .send({ email: "short@yaoyao.test", password: "short" });
    expect(res.status).toBe(400);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    if (!ctx) return;
    await registerUser(ctx, "login@yaoyao.test", "my-secret-pw");
    const ok = await ctx.http
      .post("/api/v1/auth/login")
      .send({ email: "login@yaoyao.test", password: "my-secret-pw" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.body.data.refreshToken).toBeTruthy();
    expect(ok.body.data.tokenType).toBe("Bearer");

    const wrong = await ctx.http
      .post("/api/v1/auth/login")
      .send({ email: "login@yaoyao.test", password: "wrong-pw" });
    expect(wrong.status).toBe(401);

    const unknown = await ctx.http
      .post("/api/v1/auth/login")
      .send({ email: "nobody@yaoyao.test", password: "whatever" });
    expect(unknown.status).toBe(401);
  });

  it("rotates refresh tokens; reuse revokes the family (theft detection)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "rotate@yaoyao.test");

    const r1 = await ctx.http
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: me.refreshToken });
    expect(r1.status).toBe(200);
    const token2 = r1.body.data.refreshToken as string;
    expect(token2).not.toBe(me.refreshToken);

    // The old token is now rotated: presenting it again is reuse.
    const reuse = await ctx.http
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: me.refreshToken });
    expect(reuse.status).toBe(401);

    // The family was revoked: even the successor is now dead.
    const after = await ctx.http
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: token2 });
    expect(after.status).toBe(401);
  });

  it("logs out by revoking the refresh family", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "logout@yaoyao.test");
    const res = await ctx.http
      .post("/api/v1/auth/logout")
      .set(authHeader(me.accessToken))
      .send({ refreshToken: me.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(true);

    const refresh = await ctx.http
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: me.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("rejects logout without a JWT (default-deny)", async () => {
    if (!ctx) return;
    const res = await ctx.http
      .post("/api/v1/auth/logout")
      .send({ refreshToken: "anything" });
    expect(res.status).toBe(401);
  });
});
