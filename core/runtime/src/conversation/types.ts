/**
 * Conversation turn types — MVP-002A.
 *
 * TurnInput is what the API layer passes to the runtime. TurnOutput is
 * what the runtime returns. Both are runtime-internal contracts; they are
 * NOT domain entities and carry no persistence semantics.
 */
import type { RuntimeTrace } from "../contracts/trace.js";

export interface TurnInput {
  readonly userId: string;
  readonly text: string;
  readonly traceId: string;
  /**
   * MVP-002G: idempotency key for this turn. When absent, a UUID is
   * generated (no idempotency across retries). Duplicates with the same
   * requestId return the stored response without re-running the turn.
   */
  readonly requestId?: string;
  readonly sessionId?: string | null;
}

export interface TurnOutput {
  /** The validated response text, ready for delivery. */
  readonly response: string;
  /** Per-turn observability trace (§U). */
  readonly trace: RuntimeTrace;
}

/**
 * PendingUserMessage — the Step 2 "pending event".
 *
 * In MVP-002A this is a runtime-internal in-memory record, NOT a domain
 * event: USER_MESSAGE / ASSISTANT_MESSAGE event types are not yet in the
 * domain catalog (Migration 0003 + additive EVENT_TYPES arrive when
 * conversation event persistence is actually needed — explicitly deferred
 * per the MVP-002A authorization §II.4).
 *
 * It carries the turn's correlationId so that later phases can link the
 * persisted USER_MESSAGE / ASSISTANT_MESSAGE pair.
 */
export interface PendingUserMessage {
  readonly messageId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly text: string;
  readonly occurredAt: string;
}
