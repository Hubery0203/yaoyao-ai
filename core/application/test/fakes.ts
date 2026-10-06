/**
 * In-memory fakes for application use-case unit tests.
 *
 * These are test-only doubles: they implement the port interfaces with
 * plain maps. They prove orchestration logic (ordering, error mapping,
 * ownership plumbing) — never persistence semantics, which belong to the
 * Testcontainers suites.
 */
import type { UserId } from "@yaoyao/domain";
import type {
  AuthCredentialRecord,
  AuthCredentialRepository,
  AuthDeps,
  PasswordHasher,
  RefreshSessionRecord,
  TokenService,
  TransactionManager,
} from "../src/index.js";
import type { PersistenceTransaction } from "../src/ports/persistence/transactions.js";

export function fakeTransaction(
  overrides: Partial<PersistenceTransaction> = {},
): PersistenceTransaction {
  const notImplemented = (name: string) => () => {
    throw new Error(`fake: ${name} not implemented`);
  };
  return {
    users: {
      findOwned: notImplemented("users.findOwned"),
      insert: notImplemented("users.insert"),
      save: notImplemented("users.save"),
      ...overrides.users,
    },
    aggregates: {
      loadOwned: notImplemented("aggregates.loadOwned"),
      insert: notImplemented("aggregates.insert"),
      ...overrides.aggregates,
    },
    relationships: {
      findOwned: notImplemented("relationships.findOwned"),
      saveMetrics: notImplemented("relationships.saveMetrics"),
      ...overrides.relationships,
    },
    states: {
      findOwned: notImplemented("states.findOwned"),
      insert: notImplemented("states.insert"),
      saveStateIfVersionMatches: notImplemented("states.saveStateIfVersionMatches"),
      ...overrides.states,
    },
    sessions: {
      findOwned: notImplemented("sessions.findOwned"),
      insert: notImplemented("sessions.insert"),
      save: notImplemented("sessions.save"),
      listOwned: notImplemented("sessions.listOwned"),
      ...overrides.sessions,
    },
    events: {
      append: notImplemented("events.append"),
      readOwnedAfter: notImplemented("events.readOwnedAfter"),
      readSession: notImplemented("events.readSession"),
      ...overrides.events,
    },
    memoryContainers: {
      findOwned: notImplemented("memoryContainers.findOwned"),
      insert: notImplemented("memoryContainers.insert"),
      ...overrides.memoryContainers,
    },
    memories: {
      findOwned: notImplemented("memories.findOwned"),
      insert: notImplemented("memories.insert"),
      save: notImplemented("memories.save"),
      listOwned: notImplemented("memories.listOwned"),
      ...overrides.memories,
    },
    refreshSessions: {
      insert: notImplemented("refreshSessions.insert"),
      findByTokenHash: notImplemented("refreshSessions.findByTokenHash"),
      rotate: notImplemented("refreshSessions.rotate"),
      revoke: notImplemented("refreshSessions.revoke"),
      ...overrides.refreshSessions,
    },
    idempotency: {
      begin: notImplemented("idempotency.begin"),
      complete: notImplemented("idempotency.complete"),
      fail: notImplemented("idempotency.fail"),
      find: notImplemented("idempotency.find"),
      ...overrides.idempotency,
    },
    outbox: {
      enqueueForEvent: notImplemented("outbox.enqueueForEvent"),
      findPending: notImplemented("outbox.findPending"),
      ...overrides.outbox,
    },
  } as PersistenceTransaction;
}

export interface FakeTransactionManager extends TransactionManager {
  /** Every userId runAsUser was invoked with, in order. */
  seenUserIds: UserId[];
}

export function fakeTransactionManager(
  tx: PersistenceTransaction,
): FakeTransactionManager {
  const seenUserIds: UserId[] = [];
  return {
    seenUserIds,
    runAsUser: async <T>(
      userId: UserId,
      fn: (tx: PersistenceTransaction) => Promise<T>,
    ): Promise<T> => {
      seenUserIds.push(userId);
      return fn(tx);
    },
  };
}

export function fakeCredentials(
  users: Map<string, AuthCredentialRecord> = new Map(),
  sessions: Map<string, RefreshSessionRecord> = new Map(),
): AuthCredentialRepository {
  return {
    findUserCredentialsByEmail: async (email: string) =>
      users.get(email.toLowerCase()) ?? null,
    findRefreshSessionByTokenHash: async (hash: Buffer) =>
      sessions.get(hash.toString("hex")) ?? null,
  };
}

/** Plain-text "hasher" — fast and obviously not for production. */
export function fakeHasher(): PasswordHasher {
  return {
    hash: async (plain: string) => `fake-hash:${plain}`,
    verify: async (hash: string, plain: string) =>
      hash === `fake-hash:${plain}`,
  };
}

export function fakeTokens(): TokenService & { issued: string[] } {
  const issued: string[] = [];
  return {
    issued,
    accessTokenTtlSeconds: 900,
    mintAccessToken: (userId: UserId) => {
      const token = `fake-jwt:${userId as string}:${issued.length}`;
      issued.push(token);
      return token;
    },
    verifyAccessToken: (token: string) => {
      const parts = token.split(":");
      if (parts[0] !== "fake-jwt" || !parts[1]) {
        throw new Error("invalid");
      }
      return { sub: parts[1], iat: 0, exp: 9999999999 };
    },
    newRefreshToken: () => `fake-refresh-${issued.length}-${Math.random()}`,
    hashRefreshToken: (raw: string) => Buffer.from(`hash:${raw}`),
  };
}

export function fakeAuthDeps(
  overrides: {
    credentials?: AuthCredentialRepository;
    transactions?: FakeTransactionManager;
    hasher?: PasswordHasher;
    tokens?: TokenService;
  } = {},
): AuthDeps & { transactions: FakeTransactionManager } {
  const tx = fakeTransaction({
    refreshSessions: {
      insert: async (input: {
        userId: UserId;
        tokenHash: Buffer;
        tokenFamilyId: string;
        expiresAt: Date;
        deviceMetadata?: Record<string, unknown>;
      }): Promise<RefreshSessionRecord> => ({
        refreshSessionId: "fake-rs",
        userId: input.userId,
        tokenHash: input.tokenHash,
        tokenFamilyId: input.tokenFamilyId,
        expiresAt: input.expiresAt,
        rotatedAt: null,
        revokedAt: null,
        deviceMetadata: input.deviceMetadata ?? {},
        createdAt: new Date(),
      }),
    } as never,
  });
  return {
    credentials: overrides.credentials ?? fakeCredentials(),
    transactions: overrides.transactions ?? fakeTransactionManager(tx),
    hasher: overrides.hasher ?? fakeHasher(),
    tokens: overrides.tokens ?? fakeTokens(),
  };
}
