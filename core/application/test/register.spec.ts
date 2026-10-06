/**
 * registerUser unit tests (Phase 4).
 *
 * PM rule 1 is the focus: the idempotency scope for the unauthenticated
 * registration endpoint is server-defined (public:registration) — the
 * test asserts the exact scope string the idempotency store receives, and
 * that no client input can influence it.
 */
import { describe, expect, it } from "vitest";
import {
  DuplicateEntityError,
  PUBLIC_REGISTRATION_SCOPE,
  registerUser,
} from "../src/index.js";
import { fakeAuthDeps, fakeTransaction, fakeTransactionManager } from "./fakes.js";

function recordingTx() {
  const calls: string[] = [];
  const idempotencyScopes: string[] = [];
  const tx = fakeTransaction({
    users: {
      insert: async () => {
        calls.push("users.insert");
      },
    } as never,
    aggregates: {
      insert: async () => {
        calls.push("aggregates.insert");
      },
    } as never,
    memoryContainers: {
      insert: async () => {
        calls.push("memoryContainers.insert");
        return {} as never;
      },
    } as never,
    sessions: {
      insert: async () => {
        calls.push("sessions.insert");
      },
    } as never,
    events: {
      append: async (input: { event: { type: string } }) => {
        calls.push(`events.append:${input.event.type}`);
        return { event: input.event, aggregateSeq: calls.length, recordedAt: new Date(), schemaVersion: 1 };
      },
    } as never,
    idempotency: {
      begin: async (input: { userScope: string }) => {
        idempotencyScopes.push(input.userScope);
        calls.push("idempotency.begin");
        return { outcome: "claimed" } as const;
      },
      complete: async () => {
        calls.push("idempotency.complete");
      },
      fail: async () => undefined,
      find: async () => null,
    } as never,
  });
  return { tx, calls, idempotencyScopes };
}

describe("registerUser", () => {
  it("initializes the full Core graph in one owner-scoped transaction", async () => {
    const { tx, calls } = recordingTx();
    const manager = fakeTransactionManager(tx);
    const deps = fakeAuthDeps({ transactions: manager });
    const result = await registerUser(deps, {
      email: "new@user.io",
      passwordHash: "fake-hash",
      requestBody: JSON.stringify({ email: "new@user.io" }),
    });
    expect(result.userId).toBe(manager.seenUserIds[0]);
    expect(result.duplicate).toBe(false);
    expect(calls).toContain("users.insert");
    expect(calls).toContain("aggregates.insert");
    expect(calls).toContain("memoryContainers.insert");
    expect(calls).toContain("sessions.insert");
    expect(calls.filter((c) => c.startsWith("events.append:"))).toHaveLength(5);
  });

  it("uses the server-defined public registration idempotency scope", async () => {
    const { tx, idempotencyScopes } = recordingTx();
    const deps = fakeAuthDeps({ transactions: fakeTransactionManager(tx) });
    await registerUser(deps, {
      email: "idem@user.io",
      passwordHash: "fake-hash",
      idempotencyKey: "client-key-123",
      requestBody: JSON.stringify({ email: "idem@user.io" }),
    });
    // Exactly the constant — never derived from request input.
    expect(idempotencyScopes).toEqual([PUBLIC_REGISTRATION_SCOPE]);
    expect(PUBLIC_REGISTRATION_SCOPE).toBe("public:registration");
  });

  it("skips idempotency entirely when no key is sent", async () => {
    const { tx, calls, idempotencyScopes } = recordingTx();
    const deps = fakeAuthDeps({ transactions: fakeTransactionManager(tx) });
    await registerUser(deps, {
      email: "nokey@user.io",
      passwordHash: "fake-hash",
      requestBody: JSON.stringify({ email: "nokey@user.io" }),
    });
    expect(idempotencyScopes).toEqual([]);
    expect(calls).not.toContain("idempotency.begin");
  });

  it("propagates duplicate-email as DuplicateEntityError", async () => {
    const { tx } = recordingTx();
    const dupTx: typeof tx = {
      ...tx,
      users: {
        insert: async () => {
          throw new DuplicateEntityError("User");
        },
      } as never,
    };
    const deps = fakeAuthDeps({ transactions: fakeTransactionManager(dupTx) });
    await expect(
      registerUser(deps, {
        email: "taken@user.io",
        passwordHash: "fake-hash",
        requestBody: JSON.stringify({ email: "taken@user.io" }),
      }),
    ).rejects.toBeInstanceOf(DuplicateEntityError);
  });
});
