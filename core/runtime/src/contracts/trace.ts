/**
 * RuntimeTrace — per-turn observability record (proposal §U).
 *
 * Every turn produces a trace answering "why did YaoYao say that?":
 * which input, which situation, which decision, which model, which
 * validation outcome. In MVP-002A the trace is populated by the skeleton
 * steps; later phases fill in the real sub-capability data.
 *
 * The trace is in-memory per turn (transient). It is logged (structured)
 * but never persisted as Core state.
 */
export interface RuntimeTrace {
  readonly traceId: string;
  readonly userId: string;
  readonly startedAt: string;
  /** Step 2: pending event created (in-memory; not yet persisted). */
  eventCreation?: {
    readonly messageId: string;
    readonly correlationId: string;
    readonly status: "pending";
  };
  /** Step 3: situation classification (skeleton in 002A). */
  situation?: {
    readonly intent: string;
    readonly urgency: string;
    readonly taskNature: string;
  };
  /** Step 4: context assembly (minimal in 002A). */
  context?: {
    readonly layersIncluded: ReadonlyArray<string>;
    readonly inputTextLength: number;
  };
  /** Step 5: decision (fixed default in 002A; real engine in 002F). */
  decision?: {
    readonly primaryIntent: string;
    readonly conversationMode: string;
  };
  /** Step 6: LLM generation. */
  llm?: {
    readonly providerId: string;
    readonly modelId: string;
    readonly latencyMs: number;
    readonly fallbackUsed: boolean;
  };
  /** Step 7: validation outcome. */
  validation?: {
    readonly stagesPassed: ReadonlyArray<string>;
    readonly repairs: number;
    readonly fallbackTriggered: boolean;
  };
  /** Step 8: write-back (skeleton: no-op in 002A). */
  writeback?: {
    readonly stateChanged: boolean;
    readonly eventsCommitted: number;
    readonly note: string;
  };
  /** Step 10: event recording (skeleton: deferred to later phase). */
  eventRecording?: {
    readonly status: "skipped-skeleton" | "recorded";
    readonly note: string;
  };
  readonly finishedAt?: string;
}

export function createTrace(traceId: string, userId: string): RuntimeTrace {
  return {
    traceId,
    userId,
    startedAt: new Date().toISOString(),
  };
}
