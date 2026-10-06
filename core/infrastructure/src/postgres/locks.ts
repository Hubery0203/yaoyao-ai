/**
 * Advisory-lock key derivation (Technical Proposal v0.2 §F, required
 * follow-through: deterministic and collision-resistant).
 *
 * PostgreSQL advisory locks take a single bigint (or two int32s). We derive
 * the key as the first 8 bytes of SHA-256(namespace + ":" + id),
 * interpreted as a signed big-endian int64 and rendered as a decimal
 * string for the `pg_advisory_xact_lock(bigint)` call.
 *
 * Properties:
 * - Deterministic: the same (namespace, id) always yields the same key,
 *   on any machine, in any process — no randomness, no truncation of the
 *   UUID text, no dependence on hash seeds.
 * - Collision-resistant: 64 bits from a cryptographic hash. An accidental
 *   collision would only serialize two unrelated lock streams for the
 *   duration of one transaction (a liveness cost, never a correctness
 *   violation); the UNIQUE(yaoyao_id, aggregate_seq) constraint remains the
 *   final correctness guard for sequence allocation regardless.
 * - Namespace separation: different lock purposes (event sequencing vs.
 *   schema migrations) use different namespaces and can never collide.
 */
import { createHash } from "node:crypto";

export const EVENT_SEQ_LOCK_NAMESPACE = "yaoyao.ai/event-seq/v1";
export const MIGRATION_LOCK_NAMESPACE = "yaoyao.ai/schema-migrations/v1";

export function advisoryLockKey64(namespace: string, id: string): string {
  if (!namespace || !id) {
    throw new Error("advisoryLockKey64 requires a non-empty namespace and id");
  }
  const digest = createHash("sha256")
    .update(`${namespace}:${id}`, "utf8")
    .digest();
  return digest.readBigInt64BE(0).toString(10);
}

/** Convenience for the per-YaoYao event-sequence lock. */
export function eventSeqLockKey(yaoyaoId: string): string {
  return advisoryLockKey64(EVENT_SEQ_LOCK_NAMESPACE, yaoyaoId);
}

/** The single global lock serializing schema-migration runs. */
export function migrationLockKey(): string {
  return advisoryLockKey64(MIGRATION_LOCK_NAMESPACE, "global");
}
