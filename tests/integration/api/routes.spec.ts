/**
 * Route security integration tests (Phase 4, PM rule 4).
 *
 * - Every protected route is default-deny: no token -> 401, EXCEPT the
 *   explicit public allowlist (health, login, refresh, register).
 * - Every Handoff §12 forbidden route does not exist (-> 404), plus
 *   DELETE attempts on append-only resources (-> 404/405).
 * - Ownership: a valid JWT never implies ownership (T008); cross-user
 *   access is 403/404, never data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeader,
  dockerAvailable,
  registerUser,
  setupApi,
  type ApiTestContext,
} from "./helpers.js";

const PROTECTED_ROUTES: Array<{ method: "get" | "post"; path: string }> = [
  { method: "post", path: "/api/v1/auth/logout" },
  { method: "get", path: "/api/v1/users/00000000-0000-0000-0000-000000000000" },
  { method: "get", path: "/api/v1/yaoyao" },
  { method: "get", path: "/api/v1/yaoyao/state" },
  { method: "get", path: "/api/v1/yaoyao/relationship" },
  { method: "post", path: "/api/v1/sessions" },
  { method: "post", path: "/api/v1/sessions/00000000-0000-0000-0000-000000000000/close" },
  { method: "get", path: "/api/v1/events" },
  { method: "get", path: "/api/v1/memories" },
  { method: "get", path: "/api/v1/diagnostics/replay" },
];

const FORBIDDEN_ROUTES: Array<{ method: "patch" | "delete" | "put"; path: string }> = [
  { method: "patch", path: "/api/v1/yaoyao/personality" },
  { method: "patch", path: "/api/v1/yaoyao/identity" },
  { method: "patch", path: "/api/v1/relationship/type" },
  { method: "patch", path: "/api/v1/relationship/status" },
  { method: "patch", path: "/api/v1/relationship/termination" },
  { method: "patch", path: "/api/v1/emotion/raw" },
  { method: "delete", path: "/api/v1/events" },
  { method: "delete", path: "/api/v1/memories" },
  { method: "delete", path: "/api/v1/yaoyao/state" },
  { method: "put", path: "/api/v1/yaoyao" },
  { method: "patch", path: "/api/v1/yaoyao" },
];

describe("route security", () => {
  let ctx: ApiTestContext;

  beforeAll(async () => {
    if (!(await dockerAvailable())) return;
    ctx = await setupApi();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  }, 60_000);

  it("denies every protected route without a token (default-deny)", async () => {
    if (!ctx) return;
    for (const route of PROTECTED_ROUTES) {
      const res = await ctx.http[route.method](route.path).send({});
      expect(
        res.status,
        `${route.method.toUpperCase()} ${route.path} should be 401`,
      ).toBe(401);
    }
  });

  it("denies protected routes with a malformed token", async () => {
    if (!ctx) return;
    const res = await ctx.http
      .get("/api/v1/yaoyao")
      .set(authHeader("not-a-jwt"));
    expect(res.status).toBe(401);
  });

  it("denies protected routes with a well-formed but foreign-signed token", async () => {
    if (!ctx) return;
    // A real JWT signed with the wrong secret.
    const jwt = await import("jsonwebtoken");
    const forged = jwt.sign(
      {},
      "wrong-secret-32-bytes-minimum!!!!",
      {
        algorithm: "HS256",
        subject: "00000000-0000-0000-0000-000000000000",
        issuer: "yaoyao-ai",
        audience: "yaoyao-app",
        expiresIn: 900,
      },
    );
    const res = await ctx.http.get("/api/v1/yaoyao").set(authHeader(forged));
    expect(res.status).toBe(401);
  });

  it("keeps the public allowlist open", async () => {
    if (!ctx) return;
    expect((await ctx.http.get("/health/live")).status).toBe(200);
    expect((await ctx.http.get("/health/ready")).status).toBe(200);
    // login/refresh/register are public but validate input (400, not 401).
    expect(
      (await ctx.http.post("/api/v1/auth/login").send({})).status,
    ).toBe(400);
    expect(
      (await ctx.http.post("/api/v1/auth/refresh").send({})).status,
    ).toBe(400);
    expect((await ctx.http.post("/api/v1/users").send({})).status).toBe(400);
  });

  it("has no forbidden mutation routes (Handoff §12)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "forbidden@yaoyao.test");
    for (const route of FORBIDDEN_ROUTES) {
      const res = await ctx.http[route.method](route.path)
        .set(authHeader(me.accessToken))
        .send({ type: "friend" });
      expect(
        [404, 405].includes(res.status),
        `${route.method.toUpperCase()} ${route.path} should not exist (got ${res.status})`,
      ).toBe(true);
    }
  });

  it("forbids cross-user reads: user A cannot read user B (T008)", async () => {
    if (!ctx) return;
    const a = await registerUser(ctx, "cross-a@yaoyao.test");
    const b = await registerUser(ctx, "cross-b@yaoyao.test");

    const res = await ctx.http
      .get(`/api/v1/users/${b.userId}`)
      .set(authHeader(a.accessToken));
    expect(res.status).toBe(403);

    // A's own profile works.
    const self = await ctx.http
      .get(`/api/v1/users/${a.userId}`)
      .set(authHeader(a.accessToken));
    expect(self.status).toBe(200);
    expect(self.body.data.userId).toBe(a.userId);
  });

  it("isolates sessions across users: A cannot close B's session (T008)", async () => {
    if (!ctx) return;
    const a = await registerUser(ctx, "sess-a@yaoyao.test");
    const b = await registerUser(ctx, "sess-b@yaoyao.test");

    const started = await ctx.http
      .post("/api/v1/sessions")
      .set(authHeader(b.accessToken))
      .send({});
    expect(started.status).toBe(201);
    const sessionId = started.body.data.sessionId as string;

    // A's JWT is valid but proves nothing about B's session: 404, no leak.
    const close = await ctx.http
      .post(`/api/v1/sessions/${sessionId}/close`)
      .set(authHeader(a.accessToken))
      .send({});
    expect(close.status).toBe(404);

    // B can still close its own session.
    const own = await ctx.http
      .post(`/api/v1/sessions/${sessionId}/close`)
      .set(authHeader(b.accessToken))
      .send({});
    expect(own.status).toBe(200);
    expect(own.body.data.closed).toBe(true);
  });

  it("keeps YaoYao/relationship alive after session close (T004)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "t004@yaoyao.test");
    const started = await ctx.http
      .post("/api/v1/sessions")
      .set(authHeader(me.accessToken))
      .send({});
    const sessionId = started.body.data.sessionId as string;

    await ctx.http
      .post(`/api/v1/sessions/${sessionId}/close`)
      .set(authHeader(me.accessToken))
      .send({});

    // Re-closing is idempotent.
    const again = await ctx.http
      .post(`/api/v1/sessions/${sessionId}/close`)
      .set(authHeader(me.accessToken))
      .send({});
    expect(again.body.data.closed).toBe(false);

    // The Core survives.
    const identity = await ctx.http
      .get("/api/v1/yaoyao")
      .set(authHeader(me.accessToken));
    expect(identity.status).toBe(200);
    const rel = await ctx.http
      .get("/api/v1/yaoyao/relationship")
      .set(authHeader(me.accessToken));
    expect(rel.body.data.type).toBe("deep_partner");
    expect(rel.body.data.status).toBe("active");
  });

  it("tracks state-affecting calls as events (T006)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "t006@yaoyao.test");
    await ctx.http
      .post("/api/v1/sessions")
      .set(authHeader(me.accessToken))
      .send({});

    const events = await ctx.http
      .get("/api/v1/events")
      .set(authHeader(me.accessToken));
    expect(events.status).toBe(200);
    const types = (events.body.data.events as Array<{ type: string }>).map(
      (e) => e.type,
    );
    expect(types).toContain("USER_CREATED");
    expect(types).toContain("SESSION_STARTED");
    // No password hashes or token hashes in the event stream.
    expect(JSON.stringify(events.body.data)).not.toContain("password_hash");
    expect(JSON.stringify(events.body.data)).not.toContain("token_hash");
  });

  it("serves paginated memories (empty container at birth)", async () => {
    if (!ctx) return;
    const me = await registerUser(ctx, "mem@yaoyao.test");
    const res = await ctx.http
      .get("/api/v1/memories?limit=10&offset=0")
      .set(authHeader(me.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.memories).toEqual([]);
  });
});
