/**
 * Testcontainers harness for Phase 3 persistence integration suites.
 *
 * Each suite file starts its own PostgreSQL 16 + pgvector container
 * (pinned image), applies the real forward-only migrations through the
 * production migration runner, enables login for the least-privilege
 * roles, and exposes a superuser pool (migrations, tamper setup) plus a
 * yaoyao_app pool (repository traffic) and a real TransactionManager.
 *
 * Suites SKIP (not fail) when no Docker engine is available, so the local
 * `npm run ci` gate stays green; GitHub Actions runners provide Docker
 * and run the full matrix.
 */
import { connect } from "node:net";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { Pool } from "pg";
import {
  applyMigrations,
  createPgPool,
  PostgresTransactionManager,
} from "@yaoyao/infrastructure";
import { join } from "node:path";

export const PGVECTOR_IMAGE = "pgvector/pgvector:0.8.0-pg16";
export const SUPERUSER_PASSWORD = "yaoyao_super_test";
export const APP_PASSWORD = "yaoyao_app_test";
export const READONLY_PASSWORD = "yaoyao_readonly_test";

const ROOT = join(__dirname, "..", "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "db", "migrations");

/** True when a Docker engine answers on the default socket. */
export function dockerAvailable(): Promise<boolean> {
  if (process.env.YAOYAO_TESTCONTAINERS === "0") return Promise.resolve(false);
  if (process.env.YAOYAO_TESTCONTAINERS === "1") return Promise.resolve(true);
  return new Promise((resolve) => {
    const socket = connect("/var/run/docker.sock");
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    const t = setTimeout(() => done(false), 2000);
    if (typeof (t as unknown as { unref?: () => void }).unref === "function") {
      (t as unknown as { unref: () => void }).unref();
    }
  });
}

export interface TestDatabase {
  container: StartedTestContainer;
  /** Superuser pool: migrations, role setup, tamper fixtures. */
  adminPool: Pool;
  /** Least-privilege yaoyao_app pool: all repository traffic. */
  appPool: Pool;
  manager: PostgresTransactionManager;
  connectionStringFor: (user: string, password: string) => string;
  teardown: () => Promise<void>;
}

/** Start a container, migrate it, enable role logins, wire pools. */
export async function setupDatabase(): Promise<TestDatabase> {
  const container = await new GenericContainer(PGVECTOR_IMAGE)
    .withEnvironment({
      POSTGRES_USER: "postgres",
      POSTGRES_PASSWORD: SUPERUSER_PASSWORD,
      POSTGRES_DB: "yaoyao_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/),
    )
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const connectionStringFor = (user: string, password: string) =>
    `postgres://${user}:${password}@${host}:${port}/yaoyao_test`;

  const adminPool = createPgPool({
    connectionString: connectionStringFor("postgres", SUPERUSER_PASSWORD),
    max: 5,
  });

  const run = await applyMigrations(adminPool, MIGRATIONS_DIR, "test-harness");
  if (run.applied.length !== 1 || run.applied[0] !== "0001_initial_schema") {
    throw new Error(`unexpected migration run: ${JSON.stringify(run)}`);
  }

  // The migration creates roles NOLOGIN (no secrets in SQL); the harness
  // enables login with test-only passwords out-of-band.
  await adminPool.query(
    `ALTER ROLE yaoyao_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`,
  );
  await adminPool.query(
    `ALTER ROLE yaoyao_readonly WITH LOGIN PASSWORD '${READONLY_PASSWORD}'`,
  );

  const appPool = createPgPool({
    connectionString: connectionStringFor("yaoyao_app", APP_PASSWORD),
    max: 10,
  });
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
