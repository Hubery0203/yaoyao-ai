/**
 * Migration suite — empty database to schema head through the production
 * runner. Asserts all twelve tables, extensions, roles, RLS, grants,
 * the append-only trigger, and checksum behavior.
 */
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyMigrations,
  checkSchemaCompatibility,
  discoverMigrations,
} from "@yaoyao/infrastructure";
import {
  dockerAvailable,
  MIGRATIONS_DIR,
  setupDatabase,
  type TestDatabase,
} from "./helpers.js";

const HAS_DOCKER = await dockerAvailable();

describe.skipIf(!HAS_DOCKER)("migrations: empty database to schema head", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await setupDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.teardown();
  });

  it("creates all twelve tables", async () => {
    const { rows } = await db.adminPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "users", "yaoyaos", "relationships", "core_states",
      "memory_containers", "memories", "sessions", "events",
      "refresh_sessions", "idempotency_records", "outbox", "schema_migrations",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("installs the pgvector and citext extensions", async () => {
    const { rows } = await db.adminPool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('vector','citext')`,
    );
    expect(rows.map((r) => r.extname).sort()).toEqual(["citext", "vector"]);
  });

  it("creates the four least-privilege roles (NOLOGIN until enabled)", async () => {
    const { rows } = await db.adminPool.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
       WHERE rolname IN ('yaoyao_migrate','yaoyao_app','yaoyao_readonly','yaoyao_breakglass')`,
    );
    expect(rows.map((r) => r.rolname).sort()).toEqual([
      "yaoyao_app",
      "yaoyao_breakglass",
      "yaoyao_migrate",
      "yaoyao_readonly",
    ]);
  });

  it("enables and forces RLS on every owner table", async () => {
    const { rows } = await db.adminPool.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname IN ('users','yaoyaos','relationships','core_states','memory_containers',
                         'memories','sessions','events','refresh_sessions','outbox')`,
    );
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }
  });

  it("installs the append-only trigger on events", async () => {
    const { rows } = await db.adminPool.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'events_immutable'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("denies UPDATE/DELETE on events to the app role", async () => {
    const { rows } = await db.adminPool.query<{ has_update: boolean; has_delete: boolean }>(
      `SELECT has_table_privilege('yaoyao_app', 'events', 'UPDATE') AS has_update,
              has_table_privilege('yaoyao_app', 'events', 'DELETE') AS has_delete`,
    );
    expect(rows[0].has_update).toBe(false);
    expect(rows[0].has_delete).toBe(false);
  });

  it("records the migration with a valid SHA-256 checksum", async () => {
    const { rows } = await db.adminPool.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM schema_migrations`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("0001_initial_schema");
    expect(rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    const discovered = await discoverMigrations(MIGRATIONS_DIR);
    expect(discovered[0].checksum).toBe(rows[0].checksum);
  });

  it("passes the read-only startup compatibility check", async () => {
    const check = await checkSchemaCompatibility(db.adminPool, MIGRATIONS_DIR);
    expect(check.compatible).toBe(true);
    expect(check.appliedHead).toBe("0001_initial_schema");
  });

  it("refuses a checksum-mismatched migration file", async () => {
    // Copy the migrations dir, tamper one byte, and re-check: the runner
    // must treat it as a hard deployment failure signal.
    const dir = mkdtempSync(join(tmpdir(), "migrations-tampered-"));
    try {
      for (const f of readdirSync(MIGRATIONS_DIR)) {
        copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
      }
      writeFileSync(join(dir, "0001_initial_schema.sql"), "-- tampered\n", {
        flag: "a",
      });
      const check = await checkSchemaCompatibility(db.adminPool, dir);
      expect(check.compatible).toBe(false);
      expect(check.reason).toMatch(/checksum mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: re-running applies nothing new", async () => {
    const run = await applyMigrations(db.adminPool, MIGRATIONS_DIR, "test");
    expect(run.applied).toEqual([]);
    expect(run.alreadyApplied).toEqual(["0001_initial_schema"]);
  });
});
