/**
 * Authentication use cases — login, refresh rotation, logout (Phase 4).
 *
 * Orchestration only. Credential verification uses the injected
 * PasswordHasher; token minting/verification uses the injected
 * TokenService; persistence goes through ports. No business rules here —
 * the domain owns invariants, the infrastructure owns crypto.
 *
 * Theft model: refresh tokens are single-use. Presenting an already-rotated
 * token revokes the entire token family (the legitimate client must have
 * been compromised or cloned) and returns 401.
 */
import { uuidv7, type UserId } from "@yaoyao/domain";
import { EntityNotFoundError } from "../ports/persistence/errors.js";
import {
  AuthenticationError,
  type AuthDeps,
} from "../ports/security.js";

/**
 * Fixed Argon2id hash verified (and discarded) when no user row exists,
 * so unknown-email logins cost the same as wrong-password logins and do
 * not form a fast-path user-enumeration oracle.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$N+O/m8S2zAtOB4RCQuozmQ$c0T9vmZcfFe0IjU2OfSnocz1sWoK9NO8TKhC3m/AD04";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthTokens {
  userId: UserId;
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (mirrors JWT_ACCESS_TTL_SECONDS). */
  expiresIn: number;
}

async function revokeFamily(
  deps: AuthDeps,
  userId: UserId,
  tokenFamilyId: string,
): Promise<void> {
  await deps.transactions.runAsUser(userId, (tx) =>
    tx.refreshSessions.revoke(userId, tokenFamilyId),
  );
}

/**
 * Verify credentials and open a refresh session.
 * Throws AuthenticationError for unknown email, wrong password, or
 * non-active status (all three are indistinguishable to the caller).
 */
export async function authenticateUser(
  deps: AuthDeps,
  input: {
    email: string;
    password: string;
    deviceMetadata?: Record<string, unknown>;
  },
): Promise<AuthTokens> {
  const email = input.email.trim();
  if (!email || !input.password) {
    throw new AuthenticationError();
  }

  const creds = await deps.credentials.findUserCredentialsByEmail(email);
  const verified = creds
    ? await deps.hasher.verify(creds.passwordHash, input.password)
    : await deps.hasher.verify(DUMMY_HASH, input.password).then(() => false);

  if (!verified || !creds || creds.status !== "active") {
    throw new AuthenticationError();
  }

  const userId = creds.userId;
  const refreshToken = deps.tokens.newRefreshToken();
  const tokenHash = deps.tokens.hashRefreshToken(refreshToken);
  const tokenFamilyId = uuidv7();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  // The refresh session row is owner-scoped; the RLS context is the
  // just-authenticated userId.
  await deps.transactions.runAsUser(userId, (tx) =>
    tx.refreshSessions.insert({
      userId,
      tokenHash,
      tokenFamilyId,
      expiresAt,
      deviceMetadata: input.deviceMetadata ?? {},
    }),
  );

  return {
    userId,
    accessToken: deps.tokens.mintAccessToken(userId),
    refreshToken,
    expiresIn: deps.tokens.accessTokenTtlSeconds,
  };
}

/**
 * Rotate a refresh token: the presented token is marked rotated and a
 * successor is issued atomically. Reuse of an already-rotated token is
 * treated as theft — the whole family is revoked.
 * Throws AuthenticationError for unknown, revoked, or expired tokens.
 */
export async function refreshTokens(
  deps: AuthDeps,
  input: { refreshToken: string },
): Promise<AuthTokens> {
  if (!input.refreshToken) {
    throw new AuthenticationError();
  }
  const tokenHash = deps.tokens.hashRefreshToken(input.refreshToken);
  const record =
    await deps.credentials.findRefreshSessionByTokenHash(tokenHash);
  if (!record) {
    throw new AuthenticationError();
  }
  if (record.revokedAt !== null) {
    throw new AuthenticationError();
  }
  if (record.rotatedAt !== null) {
    // Single-use violation: possible token theft. Revoke the family so a
    // stolen ancestor cannot be replayed again.
    await revokeFamily(deps, record.userId, record.tokenFamilyId);
    throw new AuthenticationError("refresh token reuse detected");
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    throw new AuthenticationError("refresh token expired");
  }

  const successor = deps.tokens.newRefreshToken();
  const successorHash = deps.tokens.hashRefreshToken(successor);
  const successorExpiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  try {
    await deps.transactions.runAsUser(record.userId, (tx) =>
      tx.refreshSessions.rotate({
        currentTokenHash: tokenHash,
        successorTokenHash: successorHash,
        successorExpiresAt,
      }),
    );
  } catch (err) {
    if (err instanceof EntityNotFoundError) {
      // Lost a concurrent rotation race: the token is now rotated, which
      // this flow treats as reuse — revoke the family defensively.
      await revokeFamily(deps, record.userId, record.tokenFamilyId);
      throw new AuthenticationError("refresh token reuse detected");
    }
    throw err;
  }

  return {
    userId: record.userId,
    accessToken: deps.tokens.mintAccessToken(record.userId),
    refreshToken: successor,
    expiresIn: deps.tokens.accessTokenTtlSeconds,
  };
}

/**
 * Revoke the refresh-token family the presented token belongs to.
 * Unknown tokens are a silent no-op success (logout must be idempotent
 * and must not leak token validity).
 */
export async function revokeRefreshSession(
  deps: AuthDeps,
  input: { refreshToken: string },
): Promise<{ revoked: boolean }> {
  if (!input.refreshToken) {
    return { revoked: false };
  }
  const tokenHash = deps.tokens.hashRefreshToken(input.refreshToken);
  const record =
    await deps.credentials.findRefreshSessionByTokenHash(tokenHash);
  if (!record) {
    return { revoked: false };
  }
  await revokeFamily(deps, record.userId, record.tokenFamilyId);
  return { revoked: true };
}
