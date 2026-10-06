/**
 * User registration — the unauthenticated entry point that births a Core.
 *
 * PM rule 1: POST /users is unauthenticated, so its Idempotency-Key MUST
 * use a server-defined public scope. This use case hardcodes
 * PUBLIC_REGISTRATION_SCOPE; the scope never comes from request input and
 * the client cannot supply a userId as the scope (no userId exists yet —
 * one is generated here, before the transaction opens, so the RLS owner
 * context and the inserted row agree).
 */
import { newUserId, type UserId } from "@yaoyao/domain";
import { PUBLIC_REGISTRATION_SCOPE, type AuthDeps } from "../ports/security.js";
import {
  initializeYaoYao,
  type InitializationResult,
} from "./initialize.js";

export interface RegisterUserInput {
  email: string;
  /** Argon2id hash — the HTTP layer hashes before calling (raw passwords never cross here). */
  passwordHash: string;
  /** Raw Idempotency-Key header value, when the client sent one. */
  idempotencyKey?: string;
  /** Canonical request body for the idempotency request-hash. */
  requestBody: string;
}

export interface RegisterUserResult {
  userId: UserId;
  yaoyaoId: string;
  sessionId: string;
  duplicate: boolean;
}

export async function registerUser(
  deps: AuthDeps,
  input: RegisterUserInput,
): Promise<RegisterUserResult> {
  // Generated up front: runAsUser pins the RLS context to this id, and the
  // users-row insert carries the same id in its WITH CHECK predicate.
  const userId = newUserId();

  const init: InitializationResult = await deps.transactions.runAsUser(
    userId,
    (tx) =>
      initializeYaoYao(tx, {
        userId,
        email: input.email.trim(),
        passwordHash: input.passwordHash,
        idempotency: input.idempotencyKey
          ? {
              userScope: PUBLIC_REGISTRATION_SCOPE,
              operation: "user-registration",
              key: input.idempotencyKey,
              requestBody: input.requestBody,
            }
          : undefined,
      }),
  );

  return {
    userId: init.userId,
    yaoyaoId: init.yaoyaoId as string,
    sessionId: init.sessionId as string,
    duplicate: init.duplicate,
  };
}
