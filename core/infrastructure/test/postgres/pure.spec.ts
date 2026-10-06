/**
 * Pure unit tests — no Docker, no database.
 *
 * Covers the deterministic building blocks Phase 3 relies on:
 * advisory-lock key derivation, idempotency hashing, migration checksums
 * and discovery. These run in the local `npm run ci` gate.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  advisoryLockKey64,
  EVENT_SEQ_LOCK_NAMESPACE,
  MIGRATION_LOCK_NAMESPACE,
  migrationLockKey,
} from "@yaoyao/infrastructure";
import {
  digestsEqual,
  idempotencyKeyHash,
  requestBodyHash,
  sha256Bytes,
} from "@yaoyao/infrastructure";
import {
  discoverMigrations,
  sha256Hex,
} from "@yaoyao/infrastructure";

describe("advisoryLockKey64", () => {
  it("is deterministic for the same (namespace, id)", () => {
    const a = advisoryLockKey64(EVENT_SEQ_LOCK_NAMESPACE, "some-yaoyao-id");
    const b = advisoryLockKey64(EVENT_SEQ_LOCK_NAMESPACE, "some-yaoyao-id");
    expect(a).toBe(b);
  });

  it("separates namespaces and ids (collision-resistant inputs)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      keys.add(advisoryLockKey64(EVENT_SEQ_LOCK_NAMESPACE, `yaoyao-${i}`));
    }
    // Same id under a different namespace must differ.
    const other = advisoryLockKey64(MIGRATION_LOCK_NAMESPACE, "yaoyao-1");
    expect(keys.has(other)).toBe(false);
    expect(keys.size).toBe(50);
  });

  it("renders as a signed 64-bit integer for pg_advisory_xact_lock(bigint)", () => {
    const key = advisoryLockKey64(EVENT_SEQ_LOCK_NAMESPACE, "x");
    const v = BigInt(key);
    expect(v >= -(2n ** 63n)).toBe(true);
    expect(v < 2n ** 63n).toBe(true);
  });

  it("rejects empty namespace/id instead of deriving a junk key", () => {
    expect(() => advisoryLockKey64("", "id")).toThrow();
    expect(() => advisoryLockKey64("ns", "")).toThrow();
  });

  it("derives a stable migration lock key", () => {
    expect(migrationLockKey()).toBe(
      advisoryLockKey64(MIGRATION_LOCK_NAMESPACE, "global"),
    );
  });
});

describe("idempotency hashing", () => {
  it("is deterministic and 32 bytes", () => {
    const a = idempotencyKeyHash("my-key");
    const b = idempotencyKeyHash("my-key");
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(32);
  });

  it("separates distinct keys and bodies", () => {
    expect(idempotencyKeyHash("a").equals(idempotencyKeyHash("b"))).toBe(false);
    expect(requestBodyHash("{}").equals(requestBodyHash("{ }"))).toBe(false);
  });

  it("rejects empty keys", () => {
    expect(() => idempotencyKeyHash("")).toThrow();
  });

  it("compares digests in constant time", () => {
    const a = sha256Bytes("x");
    expect(digestsEqual(a, Buffer.from(a))).toBe(true);
    expect(digestsEqual(a, sha256Bytes("y"))).toBe(false);
    expect(digestsEqual(a, Buffer.alloc(31))).toBe(false);
  });
});

describe("migration discovery and checksums", () => {
  it("computes the documented SHA-256 vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("discovers .sql files sorted by version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "migrations-"));
    try {
      writeFileSync(join(dir, "0002_b.sql"), "SELECT 2;");
      writeFileSync(join(dir, "0001_a.sql"), "SELECT 1;");
      writeFileSync(join(dir, "notes.txt"), "ignored");
      const found = await discoverMigrations(dir);
      expect(found.map((f) => f.version)).toEqual(["0001_a", "0002_b"]);
      expect(found[0].checksum).toBe(sha256Hex("SELECT 1;"));
      expect(found[0].checksum).toHaveLength(64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mapPgError driver-error unwrapping", () => {
  it("maps a bare 23505 to DuplicateEntityError", async () => {
    const { mapPgError } = await import("@yaoyao/infrastructure");
    const { DuplicateEntityError } = await import("@yaoyao/application");
    const err = mapPgError(
      Object.assign(new Error("duplicate"), {
        code: "23505",
        constraint: "users_email_unique",
      }),
      "User",
    );
    expect(err).toBeInstanceOf(DuplicateEntityError);
  });

  it("unwraps a Drizzle-wrapped 23505 to DuplicateEntityError", async () => {
    const { mapPgError } = await import("@yaoyao/infrastructure");
    const { DuplicateEntityError } = await import("@yaoyao/application");
    const pgError = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint: "users_email_unique",
    });
    const drizzleWrapped = Object.assign(
      new Error('Failed query: insert into "users"'),
      { cause: pgError },
    );
    const err = mapPgError(drizzleWrapped, "User");
    expect(err).toBeInstanceOf(DuplicateEntityError);
  });

  it("keeps PERSISTENCE_UNKNOWN for genuinely unknown wrapped errors", async () => {
    const { mapPgError } = await import("@yaoyao/infrastructure");
    const wrapped = Object.assign(new Error("boom"), {
      cause: new Error("no code anywhere"),
    });
    const err = mapPgError(wrapped, "User");
    expect(err.code).toBe("PERSISTENCE_UNKNOWN");
  });
});
