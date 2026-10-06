/**
 * Read-only replay / diagnostics (Phase 4, Handoff §18, T011/T012).
 *
 * Folds the ordered event sequence through the PRODUCTION domain
 * transition functions — CoreState.initial() for the STATE_CREATED
 * baseline and CoreState.transition() for STATE_CHANGED deltas. There is
 * no parallel reducer implementation; drift is impossible by construction.
 *
 * Safety (PM rule 3):
 * - The use case receives a READ-ONLY port bundle. It cannot open a write
 *   transaction, append events, or enqueue outbox intents — the types do
 *   not allow it.
 * - Non-state events are recorded in the trace but never mutate the
 *   reconstruction.
 * - Malformed STATE_CHANGED payloads and version divergences are reported
 *   as trace findings, never thrown: replay is a diagnostic, not a gate.
 */
import {
  CoreState,
  EMOTION_DIMENSIONS,
  type CoreStateChanges,
  type EmotionValues,
  type EventType,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import type {
  CoreStateRepository,
  EventStore,
  YaoYaoAggregateRepository,
} from "../ports/persistence/repositories.js";
import type { PersistedEvent } from "../ports/persistence/repositories.js";

/** The only storage surface replay may touch. No writes exist here. */
export interface ReplayReadPort {
  aggregates: Pick<YaoYaoAggregateRepository, "loadOwned">;
  states: Pick<CoreStateRepository, "findOwned">;
  events: Pick<EventStore, "readOwnedAfter">;
}

export interface ReplayTraceEntry {
  aggregateSeq: number;
  type: EventType;
  /** Whether the event contributed to the reconstructed state. */
  applied: boolean;
  resultingVersion: number | null;
  note?: string;
}

export interface ReplayDiff {
  field: string;
  reconstructed: unknown;
  persisted: unknown;
}

export interface ReplayResult {
  yaoyaoId: YaoYaoId;
  eventsFolded: number;
  reconstructedVersion: number | null;
  persistedVersion: number;
  /** True when every compared semantic field matches. */
  match: boolean;
  diffs: ReplayDiff[];
  trace: ReplayTraceEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extract a CoreStateChanges from a STATE_CHANGED payload. Returns null
 * when the payload does not carry a usable delta; the caller records a
 * trace finding. transition() still enforces value bounds.
 */
function changesFromPayload(
  payload: Readonly<Record<string, unknown>>,
): { expectedVersion: number; changes: CoreStateChanges } | null {
  const raw = payload["changes"];
  const expectedVersion = payload["expectedVersion"];
  if (!isRecord(raw) || typeof expectedVersion !== "number") return null;
  const changes: CoreStateChanges = {};
  if (isRecord(raw["emotion"])) {
    const emotion: Partial<EmotionValues> = {};
    for (const dim of EMOTION_DIMENSIONS) {
      const v = (raw["emotion"] as Record<string, unknown>)[dim];
      if (typeof v === "number") {
        (emotion as Record<string, number>)[dim] = v;
      }
    }
    if (Object.keys(emotion).length > 0) changes.emotion = emotion;
  }
  if (typeof raw["energy"] === "number") changes.energy = raw["energy"];
  if (typeof raw["socialState"] === "string") changes.socialState = raw["socialState"];
  if (typeof raw["relationshipState"] === "string") {
    changes.relationshipState = raw["relationshipState"] as CoreStateChanges["relationshipState"];
  }
  if (typeof raw["attention"] === "string") changes.attention = raw["attention"];
  if (isRecord(raw["internalState"])) {
    changes.internalState = raw["internalState"] as Record<string, string>;
  }
  return { expectedVersion, changes };
}

function semanticSnapshot(state: CoreState): Record<string, unknown> {
  const emotion: Record<string, number> = {};
  for (const dim of EMOTION_DIMENSIONS) {
    emotion[dim] = state.emotion.get(dim);
  }
  return {
    stateVersion: state.stateVersion,
    emotion,
    energy: state.energy,
    socialState: state.socialState,
    relationshipState: state.relationshipState,
    attention: state.attention,
    internalState: state.internalState,
  };
}

function diffSnapshots(
  reconstructed: Record<string, unknown>,
  persisted: Record<string, unknown>,
): ReplayDiff[] {
  const diffs: ReplayDiff[] = [];
  for (const key of Object.keys(reconstructed)) {
    const a = JSON.stringify(reconstructed[key]);
    const b = JSON.stringify(persisted[key]);
    if (a !== b) {
      diffs.push({ field: key, reconstructed: reconstructed[key], persisted: persisted[key] });
    }
  }
  return diffs;
}

export async function replayDiagnostics(
  read: ReplayReadPort,
  input: { userId: UserId; fromSeq?: number },
): Promise<ReplayResult> {
  const { userId } = input;
  const fromSeq = input.fromSeq ?? 0;

  const aggregate = await read.aggregates.loadOwned(userId);
  const yaoyaoId: YaoYaoId = aggregate.yaoyaoId;
  const persisted = await read.states.findOwned(userId);
  const events: PersistedEvent[] = await read.events.readOwnedAfter(
    userId,
    yaoyaoId,
    fromSeq,
  );

  let state: CoreState | null = null;
  const trace: ReplayTraceEntry[] = [];

  for (const pe of events) {
    const event = pe.event;
    switch (event.type) {
      case "STATE_CREATED": {
        // Production baseline: the aggregate was born from CoreState.initial().
        state = CoreState.initial({ userId, yaoyaoId });
        trace.push({
          aggregateSeq: pe.aggregateSeq,
          type: event.type,
          applied: true,
          resultingVersion: state.stateVersion,
          note: "baseline reconstructed via CoreState.initial()",
        });
        break;
      }
      case "STATE_CHANGED": {
        if (!state) {
          trace.push({
            aggregateSeq: pe.aggregateSeq,
            type: event.type,
            applied: false,
            resultingVersion: null,
            note: "no baseline yet; STATE_CREATED missing or filtered out",
          });
          break;
        }
        const delta = changesFromPayload(event.payload);
        if (!delta) {
          trace.push({
            aggregateSeq: pe.aggregateSeq,
            type: event.type,
            applied: false,
            resultingVersion: state.stateVersion,
            note: "payload carries no usable delta",
          });
          break;
        }
        try {
          // THE production transition function — no parallel implementation.
          state = state.transition(delta.expectedVersion, delta.changes);
          trace.push({
            aggregateSeq: pe.aggregateSeq,
            type: event.type,
            applied: true,
            resultingVersion: state.stateVersion,
          });
        } catch (err) {
          trace.push({
            aggregateSeq: pe.aggregateSeq,
            type: event.type,
            applied: false,
            resultingVersion: state.stateVersion,
            note: `divergence: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }
      default: {
        // Lifecycle / memory events: facts for the trace, never state.
        trace.push({
          aggregateSeq: pe.aggregateSeq,
          type: event.type,
          applied: false,
          resultingVersion: state ? state.stateVersion : null,
          note: "non-state event; recorded only",
        });
      }
    }
  }

  const diffs =
    state !== null
      ? diffSnapshots(semanticSnapshot(state), semanticSnapshot(persisted))
      : [
          {
            field: "(no baseline)",
            reconstructed: null,
            persisted: persisted.stateVersion,
          },
        ];

  return {
    yaoyaoId,
    eventsFolded: events.length,
    reconstructedVersion: state?.stateVersion ?? null,
    persistedVersion: persisted.stateVersion,
    match: diffs.length === 0,
    diffs,
    trace,
  };
}
