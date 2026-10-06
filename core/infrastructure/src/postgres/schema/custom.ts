/**
 * PostgreSQL-specific column types without a Drizzle built-in.
 *
 * These describe storage shapes only. All semantic validation stays in the
 * domain; mappers translate between driver values and domain values.
 */
import { customType } from "drizzle-orm/pg-core";

/** Case-insensitive text — canonical email uniqueness without transport logic. */
export const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

/** Raw byte strings (token hashes, SHA-256 digests). Driver maps to Buffer. */
export const bytea = customType<{ data: Buffer }>({
  dataType: () => "bytea",
});

/**
 * pgvector embedding column. Unused in MVP-001 (always NULL); the column
 * exists so a later milestone can adopt it without a table rewrite.
 * No dimension is fixed at this stage.
 */
export const vector = customType<{ data: string | null }>({
  dataType: () => "vector",
});
