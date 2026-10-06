import { DomainValidationError } from "../shared/errors.js";
import { assertValidDate } from "../shared/guards.js";
import {
  newSessionId,
  type SessionId,
  type UserId,
  type YaoYaoId,
} from "../shared/ids.js";

export const SESSION_STATUSES = ["active", "closed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Session — a temporary interaction context.
 *
 * A session may end; ending it changes NOTHING about YaoYao, the
 * relationship, state, memory, or event history. That separation is
 * structural: Session is its own entity with no reference to the
 * companion aggregates, so there is no code path from session close
 * to companion state.
 */
export class Session {
  private constructor(
    readonly sessionId: SessionId,
    readonly userId: UserId,
    readonly yaoyaoId: YaoYaoId,
    readonly startedAt: Date,
    readonly endedAt: Date | null,
    readonly status: SessionStatus,
    readonly clientInstanceId: string | null,
  ) {}

  static start(input: {
    userId: UserId;
    yaoyaoId: YaoYaoId;
    sessionId?: SessionId;
    clientInstanceId?: string | null;
  }): Session {
    return new Session(
      input.sessionId ?? newSessionId(),
      input.userId,
      input.yaoyaoId,
      new Date(),
      null,
      "active",
      input.clientInstanceId ?? null,
    );
  }

  /** Rebuild from persistence (Phase 3). */
  static reconstitute(input: {
    sessionId: SessionId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    startedAt: Date;
    endedAt: Date | null;
    status: SessionStatus;
    clientInstanceId: string | null;
  }): Session {
    if (!SESSION_STATUSES.includes(input.status)) {
      throw new DomainValidationError(`unknown session status: ${input.status}`);
    }
    assertValidDate(input.startedAt, "startedAt");
    if (input.endedAt !== null) {
      assertValidDate(input.endedAt, "endedAt");
      if (input.endedAt < input.startedAt) {
        throw new DomainValidationError("session endedAt is before startedAt");
      }
    }
    return new Session(
      input.sessionId,
      input.userId,
      input.yaoyaoId,
      input.startedAt,
      input.endedAt,
      input.status,
      input.clientInstanceId,
    );
  }

  get isActive(): boolean {
    return this.status === "active";
  }

  /**
   * Idempotent close: closing an already-closed session is a no-op that
   * reports closed=false and appends no second event (T004).
   */
  close(): { session: Session; closed: boolean } {
    if (this.status === "closed") {
      return { session: this, closed: false };
    }
    const now = new Date();
    return {
      session: new Session(
        this.sessionId,
        this.userId,
        this.yaoyaoId,
        this.startedAt,
        now,
        "closed",
        this.clientInstanceId,
      ),
      closed: true,
    };
  }
}
