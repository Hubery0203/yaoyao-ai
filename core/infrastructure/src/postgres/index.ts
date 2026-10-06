/**
 * @yaoyao/infrastructure postgres — persistence adapters (Phase 3).
 *
 * schema/      : Drizzle table definitions (storage shapes only).
 * mappers/     : row <-> domain translation; rows re-enter Core only
 *                through guarded reconstitute()/create().
 * repositories/: application port implementations (persistence adapters).
 * transaction/ : application-owned transaction scope + RLS owner context.
 * migrations/  : forward-only, checksummed migration runner.
 * locks.ts     : deterministic advisory-lock key derivation.
 * idempotency/ : SHA-256 hashing for idempotency keys/bodies.
 * client.ts    : pg pool factory (per-role pools).
 */
export * from "./schema/index.js";
export * from "./mappers/index.js";
export * from "./repositories/index.js";
export * from "./transaction/manager.js";
export * from "./migrations/runner.js";
export * from "./locks.js";
export * from "./client.js";
export { sha256Bytes, idempotencyKeyHash, requestBodyHash, digestsEqual } from "./idempotency/hash.js";
export { mapPgError, isUniqueViolation } from "./errors.js";
