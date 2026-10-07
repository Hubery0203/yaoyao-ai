/**
 * Emotion write-back use case — MVP-002E.
 *
 * Transactional: load → domain transition → CAS → STATE_CHANGED → commit.
 *
 * I-016: this use case receives an ALREADY-VALIDATED proposal (deltas).
 * It never talks to an LLM. The domain (`CoreState.transition`) is the
 * final authority on the new state — it enforces [0,1] bounds and the
 * CAS version check. The repository's `saveStateIfVersionMatches` is the
 * persistence-level CAS: on version mismatch it returns `stale` instead
 * of throwing, so the caller can reload and recompute (never silent
 * overwrite, §14).
 *
 * Runs inside the caller's transaction (PersistenceTransaction).
 * The apps/api adapter wraps it in TransactionManager.runAsUser.
 */
import {
  DomainEvent,
  EMOTION_DIMENSIONS,
  type EmotionDimension,
} from "@yaoyao/domain";
import type { PersistenceTransaction } from "../ports/persistence/index.js";
import type {
  EmotionWritebackInput,
  EmotionWritebackResult,
} from "../ports/emotion.js";

/** Clamp a delta-applied value into the domain's [0,1] bounds. */
function applyDelta(current: number, delta: number): number {
  return Math.min(1, Math.max(0, current + delta));
}

export async function applyEmotionProposal(
  tx: PersistenceTransaction,
  input: EmotionWritebackInput,
): Promise<EmotionWritebackResult> {
  const deltas = input.deltas;
  const dims = Object.keys(deltas) as EmotionDimension[];

  // No-op fast path: empty deltas → nothing to persist.
  if (dims.length === 0) {
    return { outcome: "no-change" };
  }

  // 1. Load current state (fresh read inside the transaction).
  const current = await tx.states.findOwned(input.userId);

  // Defensive: the caller should pass the version it loaded before
  // interpretation; if it drifted already, fail fast without writing.
  if (current.stateVersion !== input.expectedVersion) {
    return {
      outcome: "conflict",
      expected: input.expectedVersion,
      current: current.stateVersion,
    };
  }

  // 2. Domain transition — the ONLY authority on the new state.
  //    CoreState.transition enforces [0,1] bounds per dimension and
  //    bumps stateVersion. It cannot touch identity or relationship.
  const emotionPatch: Partial<Record<EmotionDimension, number>> = {};
  for (const dim of dims) {
    if (!EMOTION_DIMENSIONS.includes(dim)) continue;
    const delta = deltas[dim];
    if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
    emotionPatch[dim] = applyDelta(current.emotion.get(dim), delta);
  }
  if (Object.keys(emotionPatch).length === 0) {
    return { outcome: "no-change" };
  }

  let next: typeof current;
  try {
    next = current.transition(input.expectedVersion, {
      emotion: emotionPatch,
    });
  } catch (err) {
    // StaleStateVersionError → report as conflict (no silent overwrite).
    if (
      err !== null &&
      typeof err === "object" &&
      "expected" in err &&
      "current" in err
    ) {
      return {
        outcome: "conflict",
        expected: (err as { expected: number }).expected,
        current: (err as { current: number }).current,
      };
    }
    throw err;
  }

  // 3. Persistence CAS — writes only if the stored version still matches.
  const saved = await tx.states.saveStateIfVersionMatches(
    input.userId,
    input.expectedVersion,
    next,
  );
  if (saved.outcome === "stale") {
    return {
      outcome: "conflict",
      expected: saved.expected,
      current: saved.current,
    };
  }

  // 4. STATE_CHANGED event — append-only, with causation/correlation.
  //    Payload follows the replay contract: { changes, expectedVersion }.
  const event = DomainEvent.create({
    type: "STATE_CHANGED",
    actor: "SYSTEM",
    userId: input.userId,
    yaoyaoId: input.yaoyaoId,
    payload: {
      changes: { emotion: { ...emotionPatch } },
      expectedVersion: input.expectedVersion,
      newVersion: saved.state.stateVersion,
    },
    source: "CORE",
    causationId: (input.causationId ?? null) as never,
    correlationId: input.traceId,
  });
  const persisted = await tx.events.append({ event });

  return {
    outcome: "applied",
    newVersion: saved.state.stateVersion,
    newEmotion: Object.fromEntries(
      EMOTION_DIMENSIONS.map((d) => [d, saved.state.emotion.get(d)]),
    ) as Record<EmotionDimension, number>,
    eventId: String(persisted.event.eventId),
  };
}

/** Re-export domain emotion constants for use-case consumers. */
export { EMOTION_DIMENSIONS };
