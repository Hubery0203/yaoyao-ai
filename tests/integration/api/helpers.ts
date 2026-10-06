/**
 * HTTP integration harness for Phase 4 (Testcontainers + NestJS).
 *
 * Boots a real PostgreSQL 16 + pgvector container, applies the production
 * migrations (0001 + 0002 auth lookup functions), then creates the NestJS
 * API application via the production AppModule with test environment
 * config. Supertest drives the versioned /api/v1 surface.
 *
 * Suites SKIP (not fail) when no Docker engine is available, so the local
 * `npm run ci` gate stays green; GitHub Actions runners provide Docker
 * and run the full matrix.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../apps/api/src/app.module.js";
import { applyAppDefaults } from "../../../apps/api/src/app.setup.js";
import {
  PGVECTOR_IMAGE,
  SUPERUSER_PASSWORD,
  APP_PASSWORD,
  dockerAvailable,
  type TestDatabase,
} from "../postgres/helpers.js";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { Pool } from "pg";
import {
  applyMigrations,
  createPgPool,
  PostgresTransactionManager,
} from "@yaoyao/infrastructure";
import { join } from "node:path";
import request, { type SuperTest, type Test as SuperTestRequest } from "supertest";

export { dockerAvailable };

export const TEST_JWT_SECRET =
  "test-only-jwt-secret-32-bytes-min!!";

const ROOT = join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");

export interface ApiTestContext {
  app: INestApplication;
  http: SuperTest<SuperTestRequest>;
  db: TestDatabase;
  teardown: () => Promise<void>;
}

async function setupApiDatabase(): Promise<TestDatabase> {
  const container: StartedTestContainer = await new GenericContainer(PGVECTOR_IMAGE)
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: SUPERUSER_PASSWORD,
      POSTGRES_DB: "yaoyao_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const connectionStringFor = (user: string, password: string) =>
    `postgres://${user}:${password}@${host}:${port}/yaoyao_test`;

  const adminPool: Pool = createPgPool({
    connectionString: connectionStringFor("postgres", SUPERUSER_PASSWORD),
    max: 5,
  });

  const run = await applyMigrations(adminPool, MIGRATIONS_DIR, "test-harness");
  const applied = run.applied;
  if (
    applied.length !== 2 ||
    applied[0] !== "0001_initial_schema" ||
    applied[1] !== "0002_auth_lookup"
  ) {
    throw new Error(`unexpected migration run: ${JSON.stringify(run)}`);
  }

  await adminPool.query(`ALTER ROLE yaoyao_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);
  await adminPool.query(
    `ALTER ROLE yaoyao_readonly WITH LOGIN PASSWORD 'test-readonly-pw'`,
  );

  const appPool: Pool = createPgPool({
    connectionString: connectionStringFor("yaoyao_app", APP_PASSWORD),
    max: 10,
  });

  // The migration executor is the postgres superuser, so the SECURITY
  // DEFINER auth functions bypass FORCE RLS as designed.
  const manager = new PostgresTransactionManager(appPool);

  return {
    container,
    adminPool,
    appPool,
    manager,
    connectionStringFor,
    teardown: async () => {
      await appPool.end().catch(() => undefined);
      await adminPool.end().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

/**
 * Boot the full API host against a fresh container database.
 * Environment is scoped per-boot and restored afterwards.
 */
export async function setupApi(): Promise<ApiTestContext> {
  const db = await setupApiDatabase();

  const prevEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.DATABASE_URL = db.connectionStringFor("yaoyao_app", APP_PASSWORD);
  process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
  process.env.NODE_ENV = "test";

  let app: INestApplication | undefined;
  try {
    const { ThrottlerGuard } = await import("@nestjs/throttler");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Rate limiting is a production abuse control (NestJS's guard +
      // our named throttler config); the integration suites bypass it so
      // many test users can authenticate within one run. The throttler
      // decorators and named limits remain on the production routes.
      //
      // NOTE: overrideProvider (not overrideGuard) is required here.
      // overrideGuard only matches the internal `_injectables` collection,
      // but APP_GUARD-registered guards live in `_providers`, so the
      // override is silently ignored and tests get 429s. The guard IS a
      // provider (registered under its own class token in AppModule with
      // APP_GUARD as a useExisting alias), so overrideProvider hits it.
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    applyAppDefaults(app);
    await app.init();
  } catch (err) {
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = prevEnv.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = prevEnv.NODE_ENV;
    await db.teardown();
    throw err;
  }

  const http = request(app.getHttpServer());
  const teardown = async () => {
    await app?.close().catch(() => undefined);
    await db.teardown();
    process.env.DATABASE_URL = prevEnv.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = prevEnv.JWT_ACCESS_SECRET;
    process.env.NODE_ENV = prevEnv.NODE_ENV;
  };
  return { app, http, db, teardown };
}

/** Register a user via the public endpoint; returns auth artifacts. */
export async function registerUser(
  ctx: ApiTestContext,
  email: string,
  password = "correct-horse-123",
  idempotencyKey?: string,
): Promise<{
  userId: string;
  yaoyaoId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}> {
  const req = ctx.http.post("/api/v1/users").send({ email, password });
  if (idempotencyKey) req.set("Idempotency-Key", idempotencyKey);
  const res = await req;
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const { userId } = res.body.data;
  const login = await ctx.http
    .post("/api/v1/auth/login")
    .send({ email, password });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  return {
    userId,
    yaoyaoId: res.body.data.yaoyaoId,
    sessionId: res.body.data.sessionId,
    accessToken: login.body.data.accessToken,
    refreshToken: login.body.data.refreshToken,
  };
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
