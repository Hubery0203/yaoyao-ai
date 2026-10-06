import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { applyAppDefaults } from "../src/app.setup.js";

describe("health endpoints (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    applyAppDefaults(app);
    await app.init();
  });

  afterAll(async () => {
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
    // Phase 1: database is honestly reported as not yet wired.
    const db = res.body.checks.find((c: { name: string }) => c.name === "database");
    expect(db.status).toBe("not_configured");
  });

  it("health endpoints are NOT under /api/v1", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health/live");
    expect(res.status).toBe(404);
  });
});
