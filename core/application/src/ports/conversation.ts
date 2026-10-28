/**
 * Conversation event port — MVP-002G.
 *
 * USER_MESSAGE / ASSISTANT_MESSAGE persistence and C6 history loading.
 * Implemented in apps/api via TransactionManager.runAsUser (each method
 * runs in its own transaction — the Tx1/Tx2 design).
 *
 * Event semantic rule (§9): ASSISTANT_MESSAGE always carries the FINAL
 * delivered response — never a rejected/repair/raw/fallback-predecessor.
 */
import type { UserId, YaoYaoId } from "@yaoyao/domain";

/** A single conversation turn for C6 projection (no DB internals). */
export interface ConversationTurn {
  readonly role: "user" | "assistant";
  /** Trusted persisted source; media remains conversation, not an asserted owner fact. */
  readonly attachment?: 'image'|'voice';
  readonly timezone?:string;
  readonly text: string;
  readonly occurredAt: Date;
  readonly sequence: number;
}

export interface PersistMessageInput {
  /** Set only by trusted media adapters; image/OCR must not become asserted life facts. */
  readonly attachment?: 'image'|'voice';
  readonly userId: UserId;
  readonly yaoyaoId: YaoYaoId;
  readonly sessionId: string | null;
  readonly text: string;
  /** Idempotency key for this turn (request_id). */
  readonly requestId: string;
  readonly traceId: string;
}

export interface ConversationEventPort {
  /**
   * Persist USER_MESSAGE (Tx1, with idempotency guard).
   * Returns the event id, or the existing event id if this requestId
   * was already recorded (idempotent replay).
   */
  persistUserMessage(input: PersistMessageInput): Promise<{
    eventId: string;
    duplicate: boolean;
  }>;

  /**
   * Persist ASSISTANT_MESSAGE (Tx2). Only the FINAL delivered response.
   */
  persistAssistantMessage(input: PersistMessageInput): Promise<{
    eventId: string;
    response?: string;
  }>;

  /**
   * Load ordered conversation turns for C6 (most recent last).
   * Projection only — no raw event JSON, no DB fields.
   */
  loadHistory(input: {
    userId: UserId;
    yaoyaoId: YaoYaoId;
    limit: number;
    excludeRequestId?: string;
  }): Promise<ReadonlyArray<ConversationTurn>>;

  /**
   * Find a completed turn's assistant message by requestId (idempotency).
   * Returns the final delivered text, or null if the turn never completed.
   */
  findCompletedTurn(input: {
    userId: UserId;
    yaoyaoId: YaoYaoId;
    requestId: string;
    text?: string;
  }): Promise<string | null>;
}

/** NestJS injection token. */
export const CONVERSATION_EVENTS = "YAOYAO_CONVERSATION_EVENTS";
