/**
 * PostgresIdempotencyStore — the database record is authoritative.
 *
 * begin() atomically claims the (user_scope, operation, key_hash) slot via
 * a single INSERT: exactly one concurrent claimant wins; losers observe the
 * committed record. An expired record may be reclaimed by overwriting it
 * back to processing (still a single atomic UPDATE on the same unique key).
 * Redis may cache completed results with TTL but is never authoritative.
 */
import {
  EntityNotFoundError,
  PersistenceConflictError,
  type BeginIdempotencyResult,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "@yaoyao/application";
import { uuidv7 } from "@yaoyao/domain";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { mapPgError } from "../errors.js";
import {
  digestsEqual,
  idempotencyKeyHash,
  requestBodyHash,
} from "../idempotency/hash.js";
import {
  fromIdempotencyRow,
  toIdempotencyRow,
} from "../mappers/index.js";
import { idempotencyRecords } from "../schema/index.js";

const DEFAULT_TTL_SECONDS = 3600;

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Db) {}

  async begin(input: {
    userScope: string;
    operation: string;
    key: string;
    requestBody: string;
    ttlSeconds?: number;
  }): Promise<BeginIdempotencyResult> {
    const keyHash = idempotencyKeyHash(input.key);
    const reqHash = requestBodyHash(input.requestBody);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (input.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000,
    );
    try {
      // Claim the slot. ON CONFLICT DO NOTHING keeps the transaction usable:
      // a plain INSERT that hits the unique index would abort the transaction
      // (PostgreSQL), making the follow-up SELECT of the existing record
      // fail with "current transaction is aborted". With DO NOTHING the
      // loser simply observes the winner's committed record below.
      const claimed = await this.db
        .insert(idempotencyRecords)
        .values(
          toIdempotencyRow({
            idempotencyRecordId: uuidv7(),
            userScope: input.userScope,
            keyHash,
            operation: input.operation,
            requestHash: reqHash,
            status: "processing",
            expiresAt,
          }),
        )
        .onConflictDoNothing({
          target: [
            idempotencyRecords.userScope,
            idempotencyRecords.operation,
            idempotencyRecords.keyHash,
          ],
        })
        .returning({ id: idempotencyRecords.idempotencyRecordId });
      if (claimed.length === 1) return { outcome: "claimed" };
    } catch (e) {
      throw mapPgError(e, "IdempotencyRecord");
    }
    // A record already exists: observe it (possibly reclaim if expired).
    const existing = await this.findRaw(input.userScope, input.operation, keyHash);
    if (!existing) {
      throw new PersistenceConflictError(
        "idempotency claim raced; retry the operation",
      );
    }
    if (existing.expiresAt.getTime() <= now.getTime()) {
      // Reclaim the expired slot atomically — still guarded by the same
      // unique key, so concurrent reclaimers serialize on the row.
      const reclaimed = await this.db
        .update(idempotencyRecords)
        .set({
          requestHash: reqHash,
          status: "processing",
          responseRef: null,
          updatedAt: now,
          expiresAt,
        })
        .where(
          and(
            eq(idempotencyRecords.userScope, input.userScope),
            eq(idempotencyRecords.operation, input.operation),
            eq(idempotencyRecords.keyHash, keyHash),
          ),
        )
        .returning();
      if (reclaimed.length === 1) return { outcome: "claimed" };
      throw new PersistenceConflictError(
        "idempotency claim raced during reclaim; retry the operation",
      );
    }
    return {
      outcome: "existing",
      record: fromIdempotencyRow(existing),
      requestMatches: digestsEqual(existing.requestHash, reqHash),
    };
  }

  async complete(input: {
    userScope: string;
    operation: string;
    key: string;
    responseRef: Record<string, unknown>;
  }): Promise<void> {
    const keyHash = idempotencyKeyHash(input.key);
    const rows = await this.db
      .update(idempotencyRecords)
      .set({
        status: "completed",
        responseRef: { ...input.responseRef },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyRecords.userScope, input.userScope),
          eq(idempotencyRecords.operation, input.operation),
          eq(idempotencyRecords.keyHash, keyHash),
          eq(idempotencyRecords.status, "processing"),
        ),
      )
      .returning({ id: idempotencyRecords.idempotencyRecordId });
    if (rows.length === 0) {
      // Idempotent completion: an already-completed record is a no-op.
      const existing = await this.findRaw(input.userScope, input.operation, keyHash);
      if (!existing) throw new EntityNotFoundError("IdempotencyRecord");
    }
  }

  async fail(input: {
    userScope: string;
    operation: string;
    key: string;
  }): Promise<void> {
    const keyHash = idempotencyKeyHash(input.key);
    await this.db
      .update(idempotencyRecords)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(idempotencyRecords.userScope, input.userScope),
          eq(idempotencyRecords.operation, input.operation),
          eq(idempotencyRecords.keyHash, keyHash),
          eq(idempotencyRecords.status, "processing"),
        ),
      );
  }

  async find(input: {
    userScope: string;
    operation: string;
    key: string;
  }): Promise<IdempotencyRecord | null> {
    const row = await this.findRaw(
      input.userScope,
      input.operation,
      idempotencyKeyHash(input.key),
    );
    return row ? fromIdempotencyRow(row) : null;
  }

  private async findRaw(
    userScope: string,
    operation: string,
    keyHash: Buffer,
  ) {
    const rows = await this.db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.userScope, userScope),
          eq(idempotencyRecords.operation, operation),
          eq(idempotencyRecords.keyHash, keyHash),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
