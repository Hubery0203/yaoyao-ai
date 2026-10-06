/**
 * Session lifecycle use cases (Phase 4).
 *
 * The domain Session is a temporary interaction context — NOT the auth
 * session (Constitution separation; see the Phase 4 proposal §B). Starting
 * or closing a session never affects identity, relationship, state, or
 * memory; it only opens/closes the context and appends the lifecycle
 * event (T004).
 *
 * Ownership: every method takes the JWT-derived userId and resolves the
 * session through findOwned — a valid JWT is never treated as proof of
 * ownership of a specific session (defense in depth, PM rule 2).
 */
import {
  DomainEvent,
  Session,
  type SessionId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { IdempotencyKeyReusedError } from "../ports/persistence/errors.js";
import { PersistenceConflictError } from "../ports/persistence/errors.js";
import type { PersistenceTransaction } from "../ports/persistence/transactions.js";

export interface StartSessionInput {
  userId: UserId;
  clientInstanceId?: string | null;
  idempotency?: {
    /** Raw Idempotency-Key header value; scope is the authenticated userId. */
    key: string;
    requestBody: string;
    ttlSeconds?: number;
  };
}

export interface StartSessionResult {
  sessionId: SessionId;
  yaoyaoId: YaoYaoId;
  duplicate: boolean;
}

export async function startSession(
  tx: PersistenceTransaction,
  input: StartSessionInput,
): Promise<StartSessionResult> {
  const { userId } = input;

  if (input.idempotency) {
    // Server-derived scope: the JWT principal, never client input.
    const claim = await tx.idempotency.begin({
      userScope: userId as string,
      operation: "start-session",
      key: input.idempotency.key,
      requestBody: input.idempotency.requestBody,
      ttlSeconds: input.idempotency.ttlSeconds,
    });
    if (claim.outcome === "existing") {
      if (!claim.requestMatches) {
        throw new IdempotencyKeyReusedError("start-session");
      }
      const record = claim.record;
      if (record.status !== "completed" || !record.responseRef) {
        throw new PersistenceConflictError(
          "start-session is already in progress; retry later",
        );
      }
      const ref = record.responseRef as unknown as {
        sessionId: SessionId;
        yaoyaoId: YaoYaoId;
      };
      return { sessionId: ref.sessionId, yaoyaoId: ref.yaoyaoId, duplicate: true };
    }
  }

  // The Core must exist before a session can open against it.
  const aggregate = await tx.aggregates.loadOwned(userId);
  const session = Session.start({
    userId,
    yaoyaoId: aggregate.yaoyaoId,
    clientInstanceId: input.clientInstanceId ?? null,
  });
  await tx.sessions.insert(session);
  await tx.events.append({
    event: DomainEvent.create({
      type: "SESSION_STARTED",
      actor: "USER",
      userId,
      yaoyaoId: aggregate.yaoyaoId,
      sessionId: session.sessionId,
      payload: { sessionId: session.sessionId },
      source: "CLIENT",
      confidence: 1,
    }),
  });

  if (input.idempotency) {
    await tx.idempotency.complete({
      userScope: userId as string,
      operation: "start-session",
      key: input.idempotency.key,
      responseRef: {
        sessionId: session.sessionId,
        yaoyaoId: aggregate.yaoyaoId,
      } as unknown as Record<string, unknown>,
    });
  }

  return {
    sessionId: session.sessionId,
    yaoyaoId: aggregate.yaoyaoId,
    duplicate: false,
  };
}

export interface CloseSessionResult {
  sessionId: SessionId;
  /** False when the session was already closed (idempotent, T004). */
  closed: boolean;
}

export async function closeSession(
  tx: PersistenceTransaction,
  input: { userId: UserId; sessionId: SessionId },
): Promise<CloseSessionResult> {
  const { userId, sessionId } = input;
  const session = await tx.sessions.findOwned(userId, sessionId);
  const { session: closed, closed: didClose } = session.close();
  if (!didClose) {
    return { sessionId, closed: false };
  }
  await tx.sessions.save(userId, closed);
  await tx.events.append({
    event: DomainEvent.create({
      type: "SESSION_ENDED",
      actor: "USER",
      userId,
      yaoyaoId: closed.yaoyaoId,
      sessionId,
      payload: { sessionId },
      source: "CLIENT",
      confidence: 1,
    }),
  });
  return { sessionId, closed: true };
}
