/**
 * Unauthenticated credential resolution (Phase 4).
 *
 * Backed by the SECURITY DEFINER functions from migration 0002
 * (auth_find_user_by_email, auth_find_refresh_session). These are the only
 * queries in the system that read without an RLS owner context, and each
 * is narrowly scoped: exact-email or exact-token-hash, minimum columns.
 *
 * This repository is bound to the pool (not a transaction): the functions
 * need no owner context. Callers must still verify ownership for every
 * subsequent action via *Owned methods inside runAsUser — a successful
 * lookup is authentication material, never an ownership proof.
 */
import {
  type AuthCredentialRecord,
  type AuthCredentialRepository,
  type RefreshSessionRecord,
} from "@yaoyao/application";
import type { UserId, UserStatus } from "@yaoyao/domain";
import { sql } from "drizzle-orm";
import type { Db } from "../postgres/db.js";
import { branded } from "../postgres/mappers/primitives.js";

interface UserCredentialRow {
  user_id: string;
  password_hash: string;
  status: string;
}

interface RefreshSessionFunctionRow {
  refresh_session_id: string;
  user_id: string;
  token_hash: Buffer;
  token_family_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  device_metadata: Record<string, unknown>;
  created_at: Date;
}

function toBuffer(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  throw new Error("expected bytea value");
}

export class PostgresAuthCredentialRepository
  implements AuthCredentialRepository
{
  constructor(private readonly db: Db) {}

  async findUserCredentialsByEmail(
    email: string,
  ): Promise<AuthCredentialRecord | null> {
    // node-postgres driver: execute() resolves to pg's QueryResult ({ rows }).
    const result = (await this.db.execute(
      sql`SELECT user_id, password_hash, status FROM auth_find_user_by_email(${email})`,
    )) as unknown as { rows: UserCredentialRow[] };
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: branded<UserId>(row.user_id, "user_id", "auth_find_user_by_email"),
      passwordHash: row.password_hash,
      status: row.status as UserStatus,
    };
  }

  async findRefreshSessionByTokenHash(
    tokenHash: Buffer,
  ): Promise<RefreshSessionRecord | null> {
    const result = (await this.db.execute(
      sql`SELECT refresh_session_id, user_id, token_hash, token_family_id, expires_at, rotated_at, revoked_at, device_metadata, created_at FROM auth_find_refresh_session(${tokenHash})`,
    )) as unknown as { rows: RefreshSessionFunctionRow[] };
    const row = result.rows[0];
    if (!row) return null;
    return {
      refreshSessionId: row.refresh_session_id,
      userId: branded<UserId>(row.user_id, "user_id", "auth_find_refresh_session"),
      tokenHash: toBuffer(row.token_hash),
      tokenFamilyId: row.token_family_id,
      expiresAt: new Date(row.expires_at),
      rotatedAt: row.rotated_at ? new Date(row.rotated_at) : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      deviceMetadata: (row.device_metadata ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.created_at),
    };
  }
}
