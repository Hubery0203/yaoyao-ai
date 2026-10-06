/**
 * First-initialization use case — the atomic birth of a YaoYao Core.
 *
 * One transaction creates the full graph (User → YaoYao → Relationship →
 * CoreState → MemoryContainer → Session) plus exactly five ordered init
 * events. Any failure rolls back every row: no half-initialized YaoYao
 * can exist (T001 / T009).
 *
 * This is orchestration only. All invariants live in the domain
 * create()/reconstitute() calls; the use case never reinterprets them.
 */
import {
  DomainEvent,
  newMemoryContainerId,
  newUserId,
  Session,
  User,
  YaoYaoAggregate,
  type MemoryContainerId,
  type SessionId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { IdempotencyKeyReusedError } from "../ports/persistence/errors.js";
import { PersistenceConflictError } from "../ports/persistence/errors.js";
import type { PersistedEvent } from "../ports/persistence/repositories.js";
import type { PersistenceTransaction } from "../ports/persistence/transactions.js";

export interface InitializeYaoYaoInput {
  email: string;
  passwordHash: string;
  /** Deterministic ids for tests; generated when omitted. */
  userId?: UserId;
  yaoyaoId?: YaoYaoId;
  identityVersion?: string;
  idempotency?: {
    userScope: string;
    operation: string;
    key: string;
    requestBody: string;
    ttlSeconds?: number;
  };
}

export interface InitializationResult {
  userId: UserId;
  yaoyaoId: YaoYaoId;
  sessionId: SessionId;
  /** True when an existing idempotency record satisfied the request. */
  duplicate: boolean;
  events: PersistedEvent[];
}

interface InitIds {
  userId: UserId;
  yaoyaoId: YaoYaoId;
  sessionId: SessionId;
  containerId: MemoryContainerId;
}

/**
 * Run inside `TransactionManager.runAsUser(userId, tx => initializeYaoYao(tx, input))`.
 * The idempotency claim (when given) shares the same transaction as the
 * Core writes, so a rollback never leaves a completed claim behind.
 */
export async function initializeYaoYao(
  tx: PersistenceTransaction,
  input: InitializeYaoYaoInput,
): Promise<InitializationResult> {
  if (input.idempotency) {
    const claim = await tx.idempotency.begin(input.idempotency);
    if (claim.outcome === "existing") {
      if (!claim.requestMatches) {
        throw new IdempotencyKeyReusedError(input.idempotency.operation);
      }
      const record = claim.record;
      if (record.status !== "completed" || !record.responseRef) {
        throw new PersistenceConflictError(
          `${input.idempotency.operation} is already in progress; retry later`,
        );
      }
      const ref = record.responseRef as unknown as InitIds;
      return {
        userId: ref.userId,
        yaoyaoId: ref.yaoyaoId,
        sessionId: ref.sessionId,
        duplicate: true,
        events: [],
      };
    }
  }

  const userId = input.userId ?? newUserId();
  const user = User.create({ userId });
  const aggregate = YaoYaoAggregate.create({
    userId,
    yaoyaoId: input.yaoyaoId,
    identityVersion: input.identityVersion,
  });
  const containerId = newMemoryContainerId();
  const session = Session.start({ userId, yaoyaoId: aggregate.yaoyaoId });

  // FK order: every row references an already-inserted parent.
  await tx.users.insert({ user, email: input.email, passwordHash: input.passwordHash });
  await tx.aggregates.insert(aggregate);
  await tx.memoryContainers.insert({ containerId, userId, yaoyaoId: aggregate.yaoyaoId });
  await tx.sessions.insert(session);

  const events: PersistedEvent[] = [];
  const appendInit = async (
    type: "USER_CREATED" | "YAOYAO_CREATED" | "RELATIONSHIP_CREATED" | "STATE_CREATED" | "SESSION_STARTED",
    payload: Record<string, unknown>,
    sessionId: SessionId | null,
  ): Promise<void> => {
    events.push(
      await tx.events.append({
        event: DomainEvent.create({
          type,
          actor: "SYSTEM",
          userId,
          yaoyaoId: aggregate.yaoyaoId,
          sessionId,
          payload,
          source: "SYSTEM",
          confidence: 1,
        }),
      }),
    );
  };

  await appendInit("USER_CREATED", { email: input.email }, null);
  await appendInit("YAOYAO_CREATED", { identityKey: aggregate.yaoyao.identityKey }, null);
  await appendInit("RELATIONSHIP_CREATED", { type: aggregate.relationship.type }, null);
  await appendInit("STATE_CREATED", { stateVersion: aggregate.state.stateVersion }, null);
  await appendInit("SESSION_STARTED", { sessionId: session.sessionId }, session.sessionId);

  if (input.idempotency) {
    const ref: InitIds & { relationshipId: string; stateId: string } = {
      userId,
      yaoyaoId: aggregate.yaoyaoId,
      sessionId: session.sessionId,
      containerId,
      relationshipId: aggregate.relationship.relationshipId,
      stateId: aggregate.state.stateId,
    };
    await tx.idempotency.complete({
      userScope: input.idempotency.userScope,
      operation: input.idempotency.operation,
      key: input.idempotency.key,
      responseRef: ref as unknown as Record<string, unknown>,
    });
  }

  return {
    userId,
    yaoyaoId: aggregate.yaoyaoId,
    sessionId: session.sessionId,
    duplicate: false,
    events,
  };
}
