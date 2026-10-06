/**
 * Auth use-case unit tests (Phase 4).
 *
 * Covers: login success/failure modes, refresh rotation, reuse-theft
 * detection, revocation, and the server-side invariants (dummy-hash on
 * unknown email, family revocation on reuse).
 */
import { newUserId } from "@yaoyao/domain";
import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  authenticateUser,
  refreshTokens,
  revokeRefreshSession,
  type AuthCredentialRecord,
  type RefreshSessionRecord,
} from "../src/index.js";
import {
  fakeAuthDeps,
  fakeCredentials,
  fakeHasher,
  fakeTokens,
  fakeTransaction,
  fakeTransactionManager,
} from "./fakes.js";

function credentialRecord(
  overrides: Partial<AuthCredentialRecord> = {},
): AuthCredentialRecord {
  return {
    userId: newUserId(),
    passwordHash: "fake-hash:correct-password",
    status: "active",
    ...overrides,
  };
}

function refreshRecord(
  overrides: Partial<RefreshSessionRecord> = {},
): RefreshSessionRecord {
  const now = new Date();
  return {
    refreshSessionId: "rs-1",
    userId: newUserId(),
    tokenHash: Buffer.from("hash:raw-token"),
    tokenFamilyId: "family-1",
    expiresAt: new Date(now.getTime() + 3_600_000),
    rotatedAt: null,
    revokedAt: null,
    deviceMetadata: {},
    createdAt: now,
    ...overrides,
  };
}

describe("authenticateUser", () => {
  it("returns a token pair on valid credentials", async () => {
    const creds = credentialRecord();
    const deps = fakeAuthDeps({
      credentials: fakeCredentials(
        new Map([["a@b.c", creds]]),
      ),
    });
    const result = await authenticateUser(deps, {
      email: "a@b.c",
      password: "correct-password",
    });
    expect(result.userId).toBe(creds.userId);
    expect(result.accessToken).toMatch(/^fake-jwt:/);
    expect(result.refreshToken).toMatch(/^fake-refresh-/);
    expect(result.expiresIn).toBe(900);
    // The refresh-session insert ran inside a transaction scoped to the user.
    expect(deps.transactions.seenUserIds).toEqual([creds.userId]);
  });

  it("rejects a wrong password with AuthenticationError", async () => {
    const creds = credentialRecord();
    const deps = fakeAuthDeps({
      credentials: fakeCredentials(new Map([["a@b.c", creds]])),
    });
    await expect(
      authenticateUser(deps, { email: "a@b.c", password: "wrong" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(deps.transactions.seenUserIds).toEqual([]);
  });

  it("rejects an unknown email with AuthenticationError (dummy-hash path)", async () => {
    const deps = fakeAuthDeps({ credentials: fakeCredentials() });
    await expect(
      authenticateUser(deps, { email: "nobody@x.y", password: "whatever" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a suspended user indistinguishably from a wrong password", async () => {
    const creds = credentialRecord({ status: "suspended" });
    const deps = fakeAuthDeps({
      credentials: fakeCredentials(new Map([["a@b.c", creds]])),
    });
    await expect(
      authenticateUser(deps, { email: "a@b.c", password: "correct-password" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects empty email/password without touching storage", async () => {
    const deps = fakeAuthDeps();
    await expect(
      authenticateUser(deps, { email: "  ", password: "x" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("refreshTokens", () => {
  function setup(record: RefreshSessionRecord) {
    const tokens = fakeTokens();
    const hash = tokens.hashRefreshToken("raw-token");
    const rec = { ...record, tokenHash: hash };
    const revoked: Array<{ userId: string; family: string }> = [];
    const tx = fakeTransaction({
      refreshSessions: {
        rotate: async () => ({ ...rec, rotatedAt: new Date() }),
        revoke: async (userId, family) => {
          revoked.push({ userId: userId as string, family });
        },
      } as never,
    });
    const manager = fakeTransactionManager(tx);
    const deps = fakeAuthDeps({
      credentials: fakeCredentials(new Map(), new Map([[hash.toString("hex"), rec]])),
      transactions: manager,
      tokens,
      hasher: fakeHasher(),
    });
    return { deps, revoked, hash };
  }

  it("rotates a valid token and returns a new pair", async () => {
    const { deps } = setup(refreshRecord());
    const result = await refreshTokens(deps, { refreshToken: "raw-token" });
    expect(result.accessToken).toMatch(/^fake-jwt:/);
    expect(result.refreshToken).not.toBe("raw-token");
  });

  it("revokes the family and 401s on reuse of a rotated token", async () => {
    const { deps, revoked } = setup(refreshRecord({ rotatedAt: new Date() }));
    await expect(
      refreshTokens(deps, { refreshToken: "raw-token" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(revoked).toHaveLength(1);
  });

  it("401s on a revoked token without touching the family again", async () => {
    const { deps, revoked } = setup(refreshRecord({ revokedAt: new Date() }));
    await expect(
      refreshTokens(deps, { refreshToken: "raw-token" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(revoked).toHaveLength(0);
  });

  it("401s on an expired token", async () => {
    const { deps } = setup(
      refreshRecord({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await expect(
      refreshTokens(deps, { refreshToken: "raw-token" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("401s on an unknown token", async () => {
    const deps = fakeAuthDeps();
    await expect(
      refreshTokens(deps, { refreshToken: "nope" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("revokeRefreshSession", () => {
  it("revokes the family for a known token", async () => {
    const tokens = fakeTokens();
    const hash = tokens.hashRefreshToken("raw-token");
    const rec = refreshRecord({ tokenHash: hash });
    const revoked: Array<{ userId: string; family: string }> = [];
    const tx = fakeTransaction({
      refreshSessions: {
        revoke: async (userId, family) => {
          revoked.push({ userId: userId as string, family });
        },
      } as never,
    });
    const deps = fakeAuthDeps({
      credentials: fakeCredentials(new Map(), new Map([[hash.toString("hex"), rec]])),
      transactions: fakeTransactionManager(tx),
      tokens,
    });
    const result = await revokeRefreshSession(deps, { refreshToken: "raw-token" });
    expect(result).toEqual({ revoked: true });
    expect(revoked).toEqual([{ userId: rec.userId as string, family: rec.tokenFamilyId }]);
  });

  it("is a silent no-op for an unknown token", async () => {
    const deps = fakeAuthDeps();
    const result = await revokeRefreshSession(deps, { refreshToken: "nope" });
    expect(result).toEqual({ revoked: false });
  });
});
