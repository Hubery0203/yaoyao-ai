/**
 * Conversation event use cases — MVP-002G.
 *
 * Pure application logic; runs inside the caller's transaction.
 * The apps/api adapter wraps each in TransactionManager.runAsUser.
 */
import { DomainEvent } from "@yaoyao/domain";
import type { PersistenceTransaction } from "../ports/persistence/index.js";
import type {
  ConversationTurn,
  PersistMessageInput,
} from "../ports/conversation.js";

/**
 * Persist a USER_MESSAGE event. Idempotent on (requestId): if an event
 * with the same correlationId already exists, return it as duplicate
 * instead of appending a second one.
 */
export async function persistUserMessage(
  tx: PersistenceTransaction,
  input: PersistMessageInput,
): Promise<{ eventId: string; duplicate: boolean }> {
  // Idempotency: check for an existing USER_MESSAGE with this requestId.
  const existing = await tx.events.readOwnedAfter(
    input.userId,
    input.yaoyaoId,
    0,
  );
  const dup = existing.find(
    (e) =>
      e.event.type === "USER_MESSAGE" &&
      e.event.correlationId === input.requestId,
  );
  if (dup) {
    return { eventId: String(dup.event.eventId), duplicate: true };
  }

  const event = DomainEvent.create({
    type: "USER_MESSAGE",
    actor: "USER",
    userId: input.userId,
    yaoyaoId: input.yaoyaoId,
    sessionId: input.sessionId as never,
    payload: { text: input.text },
    source: "CLIENT",
    correlationId: input.requestId,
  });
  const persisted = await tx.events.append({ event });
  return { eventId: String(persisted.event.eventId), duplicate: false };
}

/**
 * Persist an ASSISTANT_MESSAGE event. The text MUST be the final
 * delivered response (G-RED-001) — the caller guarantees this.
 */
export async function persistAssistantMessage(
  tx: PersistenceTransaction,
  input: PersistMessageInput,
): Promise<{ eventId: string }> {
  const event = DomainEvent.create({
    type: "ASSISTANT_MESSAGE",
    actor: "YAOYAO",
    userId: input.userId,
    yaoyaoId: input.yaoyaoId,
    sessionId: input.sessionId as never,
    payload: { text: input.text },
    source: "CORE",
    correlationId: input.requestId,
  });
  const persisted = await tx.events.append({ event });
  return { eventId: String(persisted.event.eventId) };
}

/**
 * Find a completed turn's ASSISTANT_MESSAGE by requestId.
 * Used for idempotent replay: if the turn already completed, return
 * the final delivered text instead of re-running the pipeline.
 */
export async function findCompletedTurn(
  tx: PersistenceTransaction,
  input: {
    userId: Parameters<PersistenceTransaction["states"]["findOwned"]>[0];
    yaoyaoId: Parameters<PersistenceTransaction["events"]["readOwnedAfter"]>[1];
    requestId: string;
  },
): Promise<string | null> {
  const events = await tx.events.readOwnedAfter(
    input.userId,
    input.yaoyaoId,
    0,
  );
  const found = events.find(
    (e) =>
      e.event.type === "ASSISTANT_MESSAGE" &&
      e.event.correlationId === input.requestId,
  );
  if (!found) return null;
  const payload = found.event.payload as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : null;
}

/**
 * Load ordered conversation turns for C6.
 * Projection only: role/text/timestamp/sequence. No raw event JSON.
 */
export async function loadConversationHistory(
  tx: PersistenceTransaction,
  input: {
    userId: Parameters<PersistenceTransaction["states"]["findOwned"]>[0];
    yaoyaoId: Parameters<PersistenceTransaction["events"]["readOwnedAfter"]>[1];
    limit: number;
  },
): Promise<ReadonlyArray<ConversationTurn>> {
  const events = await tx.events.readOwnedAfter(
    input.userId,
    input.yaoyaoId,
    0,
  );
  const turns: ConversationTurn[] = [];
  for (const { event, aggregateSeq } of events) {
    if (
      event.type !== "USER_MESSAGE" &&
      event.type !== "ASSISTANT_MESSAGE"
    ) {
      continue;
    }
    const payload = event.payload as { text?: unknown };
    if (typeof payload.text !== "string") continue;
    turns.push({
      role: event.type === "USER_MESSAGE" ? "user" : "assistant",
      text: payload.text,
      occurredAt: event.occurredAt,
      sequence: aggregateSeq,
    });
  }
  // Already in sequence order; take the most recent `limit`.
  return turns.slice(-input.limit);
}
