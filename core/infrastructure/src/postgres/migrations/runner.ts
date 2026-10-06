/**
 * Forward-only, checksummed migration runner (Technical Proposal v0.2 §B).
 *
 * Discipline:
 * - One timestamped SQL file per change under db/migrations/; an applied
 *   file is never edited or reordered.
 * - The runner computes SHA-256 over canonical file bytes. A version
 *   already applied with a different checksum is a hard deployment
 *   failure (MigrationChecksumMismatchError).
 * - Each migration runs in its own transaction; the history row commits
 *   with it. A global advisory lock serializes concurrent runners.
 * - No down-migrations: recovery is a new forward migration.
 * - A migration must never rewrite frozen values or make events mutable
 *   (enforced by review, not by this runner).
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { MigrationChecksumMismatchError } from "@yaoyao/application";
import { migrationLockKey } from "../locks.js";

export interface DiscoveredMigration {
  /** Sortable version, e.g. "0001_initial_schema". */
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunResult {
  applied: string[];
  alreadyApplied: string[];
}

/** SHA-256 hex over canonical (UTF-8) file bytes. */
export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Discover *.sql migrations sorted by version. */
export async function discoverMigrations(
  migrationsDir: string,
): Promise<DiscoveredMigration[]> {
  const entries = await readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  const out: DiscoveredMigration[] = [];
  for (const filename of files) {
    const version = filename.slice(0, -".sql".length);
    const sql = await readFile(join(migrationsDir, filename), "utf8");
    out.push({ version, filename, sql, checksum: sha256Hex(sql) });
  }
  return out;
}

interface AppliedRow {
  version: string;
  checksum: string;
}

async function readApplied(client: {
  query: (text: string, params?: unknown[]) => Promise<{ rows: AppliedRow[] }>;
}): Promise<Map<string, string>> {
  let rows: AppliedRow[];
  try {
    const res = await client.query(
      "SELECT version, checksum FROM schema_migrations",
    );
    rows = res.rows;
  } catch (e) {
    // 42P01 undefined_table: fresh database, nothing applied yet.
    if (
      e !== null &&
      typeof e === "object" &&
      (e as { code?: string }).code === "42P01"
    ) {
      return new Map();
    }
    throw e;
  }
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

/**
 * Apply pending migrations. Safe to run concurrently: the global
 * advisory lock serializes runners, and each migration is idempotent
 * only in the sense that re-running applies nothing new.
 */
export async function applyMigrations(
  pool: Pool,
  migrationsDir: string,
  appliedBy = "migrator",
): Promise<MigrationRunResult> {
  const discovered = await discoverMigrations(migrationsDir);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      migrationLockKey(),
    ]);
    const applied = await readApplied(client);
    const result: MigrationRunResult = { applied: [], alreadyApplied: [] };
    for (const m of discovered) {
      const recorded = applied.get(m.version);
      if (recorded !== undefined) {
        if (recorded !== m.checksum) {
          throw new MigrationChecksumMismatchError(m.version);
        }
        result.alreadyApplied.push(m.version);
        continue;
      }
      const started = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, checksum, applied_at, applied_by, execution_ms)
           VALUES ($1, $2, now(), $3, $4)`,
          [m.version, m.checksum, appliedBy, Date.now() - started],
        );
        await client.query("COMMIT");
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore — original error is what matters
        }
        throw e;
      }
      result.applied.push(m.version);
    }
    return result;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [
        migrationLockKey(),
      ]);
    } catch {
      // ignore unlock failures on a released client
    }
    client.release();
  }
}

export interface CompatibilityCheck {
  compatible: boolean;
  /** Highest applied version, or null on a fresh database. */
  appliedHead: string | null;
  /** Highest discovered version. */
  expectedHead: string | null;
  reason: string;
}

/**
 * Read-only startup compatibility check. Refuses startup when history is
 * missing (fresh DB needs migration first), ahead of supported, or
 * checksum-mismatched. Performs no writes and takes no locks.
 */
export async function checkSchemaCompatibility(
  pool: Pool,
  migrationsDir: string,
): Promise<CompatibilityCheck> {
  const discovered = await discoverMigrations(migrationsDir);
  const expectedHead = discovered.length > 0
    ? discovered[discovered.length - 1].version
    : null;
  const byVersion = new Map(discovered.map((d) => [d.version, d.checksum]));
  const client = await pool.connect();
  try {
    const applied = await readApplied(client);
    if (applied.size === 0) {
      return {
        compatible: false,
        appliedHead: null,
        expectedHead,
        reason: "no migrations applied; run the migration job first",
      };
    }
    for (const [version, checksum] of applied) {
      const expected = byVersion.get(version);
      if (expected === undefined) {
        return {
          compatible: false,
          appliedHead: maxVersion([...applied.keys()]),
          expectedHead,
          reason: `database has unknown migration ${version}; binary is behind the database`,
        };
      }
      if (expected !== checksum) {
        return {
          compatible: false,
          appliedHead: maxVersion([...applied.keys()]),
          expectedHead,
          reason: `checksum mismatch on applied migration ${version}`,
        };
      }
    }
    const appliedHead = maxVersion([...applied.keys()]);
    if (appliedHead !== expectedHead) {
      return {
        compatible: false,
        appliedHead,
        expectedHead,
        reason: `database head ${appliedHead} does not match expected ${expectedHead}; run the migration job`,
      };
    }
    return {
      compatible: true,
      appliedHead,
      expectedHead,
      reason: "schema head matches",
    };
  } finally {
    client.release();
  }
}

function maxVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return versions.sort().at(-1) ?? null;
}
