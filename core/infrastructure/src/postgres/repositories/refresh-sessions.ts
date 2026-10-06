/**
 * PostgresRefreshSessionRepository — rotation seam (endpoints land in Phase 4).
 *
 * Rotation is atomic under SELECT ... FOR UPDATE: the current row is
 * verified live (not rotated, not revoked) and marked rotated while the
 * successor row is inserted, all in the caller's transaction. Raw token
 * material is never persisted — only SHA-256 hashes.
 */
import {
  EntityNotFoundError,
  type RefreshSessionRecord,
  type RefreshSessionRepository,
} from "@yaoyao/application";
import { uuidv7, type UserId } from "@yaoyao/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db.js";
import { mapPgError } from "../errors.js";
import {
  fromRefreshSessionRow,
  toRefreshSessionRow,
} from "../mappers/index.js";
import { refreshSessions } from "../schema/index.js";

export class PostgresRefreshSessionRepository
  implements RefreshSessionRepository
{
  constructor(private readonly db: Db) {}

  async insert(input: {
    refreshSessionId?: string;
    userId: UserId;
    tokenHash: Buffer;
    tokenFamilyId: string;
    expiresAt: Date;
    deviceMetadata?: Record<string, unknown>;
  }): Promise<RefreshSessionRecord> {
    try {
      const [row] = await this.db
        .insert(refreshSessions)
        .values(
          toRefreshSessionRow({
            refreshSessionId: input.refreshSessionId ?? uuidv7(),
            userId: input.userId,
            tokenHash: input.tokenHash,
            tokenFamilyId: input.tokenFamilyId,
            expiresAt: input.expiresAt,
            deviceMetadata: input.deviceMetadata ?? {},
          }),
        )
        .returning();
      return fromRefreshSessionRow(row);
    } catch (e) {
      throw mapPgError(e, "RefreshSession");
    }
  }

  async findByTokenHash(tokenHash: Buffer): Promise<RefreshSessionRecord | null> {
    const rows = await this.db
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.tokenHash, tokenHash))
      .limit(1);
    if (rows.length === 0) return null;
    return fromRefreshSessionRow(rows[0]);
  }

  async rotate(input: {
    currentTokenHash: Buffer;
    successorTokenHash: Buffer;
    successorExpiresAt: Date;
  }): Promise<RefreshSessionRecord> {
    // Row-level lock: concurrent rotations of the same token serialize here.
    const [current] = await this.db
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.tokenHash, input.currentTokenHash))
      .for("update")
      .limit(1);
    if (!current || current.rotatedAt !== null || current.revokedAt !== null) {
      throw new EntityNotFoundError("RefreshSession");
    }
    const now = new Date();
    await this.db
      .update(refreshSessions)
      .set({ rotatedAt: now })
      .where(eq(refreshSessions.refreshSessionId, current.refreshSessionId));
    const [successor] = await this.db
      .insert(refreshSessions)
      .values(
        toRefreshSessionRow({
          refreshSessionId: uuidv7(),
          userId: current.userId as UserId,
          tokenHash: input.successorTokenHash,
          tokenFamilyId: current.tokenFamilyId,
          expiresAt: input.successorExpiresAt,
          deviceMetadata: {},
        }),
      )
      .returning();
    return fromRefreshSessionRow(successor);
  }

  async revoke(userId: UserId, tokenFamilyId: string): Promise<void> {
    await this.db
      .update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshSessions.userId, userId as string),
          eq(refreshSessions.tokenFamilyId, tokenFamilyId),
          isNull(refreshSessions.revokedAt),
        ),
      );
  }
}
