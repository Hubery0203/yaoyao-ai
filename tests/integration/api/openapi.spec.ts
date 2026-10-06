/**
 * OpenAPI contract test (Phase 4).
 *
 * Pins the exact route inventory of the versioned API surface and proves
 * the Handoff §12 forbidden routes are absent from the contract. This is
 * the machine-readable counterpart of the forbidden-route negative tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../../apps/api/src/app.setup.js";
import { dockerAvailable, setupApi, type ApiTestContext } from "./helpers.js";

const EXPECTED_ROUTES: Array<{ method: string; path: string }> = [
  { method: "post", path: "/api/v1/auth/login" },
  { method: "post", path: "/api/v1/auth/refresh" },
  { method: "post", path: "/api/v1/auth/logout" },
  { method: "post", path: "/api/v1/users" },
  { method: "get", path: "/api/v1/users/{user_id}" },
  { method: "get", path: "/api/v1/yaoyao" },
  { method: "get", path: "/api/v1/yaoyao/state" },
  { method: "get", path: "/api/v1/yaoyao/relationship" },
  { method: "post", path: "/api/v1/sessions" },
  { method: "post", path: "/api/v1/sessions/{session_id}/close" },
  { method: "get", path: "/api/v1/events" },
  { method: "get", path: "/api/v1/memories" },
  { method: "get", path: "/api/v1/diagnostics/replay" },
  { method: "get", path: "/health/live" },
  { method: "get", path: "/health/ready" },
];

const FORBIDDEN_PATH_FRAGMENTS = [
  "personality",
  "relationship/type",
  "relationship/status",
  "relationship/termination",
  "emotion/raw",
];

describe("OpenAPI contract", () => {
  let ctx: ApiTestContext;

  beforeAll(async () => {
    if (!(await dockerAvailable())) return;
    ctx = await setupApi();
  }, 120_000);

  afterAll(async () => {
    await ctx?.teardown();
  }, 60_000);

  it("documents exactly the approved route inventory", async () => {
    if (!ctx) return;
    const document = buildOpenApiDocument(ctx.app);
    const actual: Array<{ method: string; path: string }> = [];
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const method of Object.keys(methods as object)) {
        if (["get", "post", "put", "patch", "delete"].includes(method)) {
          actual.push({ method, path });
        }
      }
    }
    const sortKey = (r: { method: string; path: string }) =>
      `${r.method} ${r.path}`;
    expect(actual.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(
      [...EXPECTED_ROUTES].sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    );
  });

  it("contains no forbidden mutation paths", async () => {
    if (!ctx) return;
    const document = buildOpenApiDocument(ctx.app);
    const paths = Object.keys(document.paths);
    for (const fragment of FORBIDDEN_PATH_FRAGMENTS) {
      expect(
        paths.filter((p) => p.includes(fragment)),
        `forbidden fragment '${fragment}' must not appear in the contract`,
      ).toEqual([]);
    }
    // No PATCH/PUT/DELETE anywhere on the versioned surface.
    for (const [path, methods] of Object.entries(document.paths)) {
      if (!path.startsWith("/api/v1")) continue;
      const verbs = Object.keys(methods as object);
      expect(
        verbs.filter((v) => ["put", "patch", "delete"].includes(v)),
        `${path} must not expose mutating verbs`,
      ).toEqual([]);
    }
  });
});
