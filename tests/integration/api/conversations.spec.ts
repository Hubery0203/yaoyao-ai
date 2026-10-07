/**
 * Conversation endpoint integration tests — MVP-002A.
 *
 * POST /api/v1/conversations/messages:
 * - 401 without a token (default-deny; the endpoint is authenticated).
 * - 200 with a valid JWT → structured echo response via Mock provider.
 * - 400 on invalid body (empty text).
 *
 * Skips (not fails) when Docker is unavailable, like all integration suites.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeader,
  dockerAvailable,
  registerUser,
  setupApi,
  type ApiTestContext,
} from "./helpers.js";

describe("POST /api/v1/conversations/messages (MVP-002A)", () => {
  let ctx: ApiTestContext;

  beforeAll(async () => {
    if (!(await dockerAvailable())) return;
    ctx = await setupApi();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  }, 60_000);

  it("denies unauthenticated requests (401)", async () => {
    if (!ctx) return;
    await ctx.http.post("/api/v1/conversations/messages").send({ text: "hi" }).expect(401);
  });

  it("runs the echo path for an authenticated user", async () => {
    if (!ctx) return;
    const { accessToken } = await registerUser(ctx, "conv-echo@example.com", "Password123!");
    const res = await ctx.http
      .post("/api/v1/conversations/messages")
      .set(authHeader(accessToken))
      .send({ text: "你好呀" })
      .expect(200);
    expect(res.body.response).toContain("你好呀");
    expect(typeof res.body.response).toBe("string");
  });

  it("rejects empty text (400)", async () => {
    if (!ctx) return;
    const { accessToken } = await registerUser(ctx, "conv-bad@example.com", "Password123!");
    await ctx.http
      .post("/api/v1/conversations/messages")
      .set(authHeader(accessToken))
      .send({ text: "" })
      .expect(400);
  });
});
