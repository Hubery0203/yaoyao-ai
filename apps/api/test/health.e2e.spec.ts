import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { applyAppDefaults } from "../src/app.setup.js";

describe("health endpoints (e2e)", () => {
  let app: INestApplication;
  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  };

  beforeAll(async () => {
    // The host fails closed without these; the health probes themselves
    // make no database calls, so an unreachable URL is fine here.
    process.env.DATABASE_URL = "postgres://localhost:5432/yaoyao_test";
    process.env.JWT_ACCESS_SECRET = "test-only-jwt-secret-32-bytes-min!!";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyAppDefaults(app);
    await app.init();
    // First-load Vite transform of the full host graph can exceed the
    // default 10s hook budget on a cold cache.
  }, 60_000);

  afterAll(async () => {
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = prevEnv.JWT_ACCESS_SECRET;
    await app.close();
  });

  it("GET /health/live returns 200 (unversioned)", async () => {
    const res = await request(app.getHttpServer()).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "yaoyao-ai" });
  });

  it("GET /health/ready returns 200 with dependency checks", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(Array.isArray(res.body.checks)).toBe(true);
    const names = res.body.checks.map((c: { name: string }) => c.name);
    expect(names).toContain("config");
    expect(names).toContain("database");
    // Phase 4: the probe is wired; with the dummy URL it honestly reports
    // "degraded" (unreachable). Shape is what this contract pins.
    const db = res.body.checks.find((c: { name: string }) => c.name === "database");
    expect(["ok", "degraded", "not_configured"]).toContain(db.status);
  });

  it("health endpoints are NOT under /api/v1", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health/live");
    expect(res.status).toBe(404);
  });
});
