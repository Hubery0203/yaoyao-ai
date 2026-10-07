/**
 * Emotion ports — MVP-002E Emotion + State Write-back.
 *
 * I-016 is the supreme constraint: the interpreter proposes, the domain
 * disposes. NOTHING in this file grants persistence authority.
 *
 *   EmotionInterpreter  →  EmotionProposal (proposal only, no writes)
 *   EmotionStateWriter  →  transactional write-back (validation → domain
 *                           transition → CAS → STATE_CHANGED → commit)
 *
 * The three layers stay separate (§4):
 *   Emotion State        = CoreState.emotion (9-dim vector) — "what is YaoYao feeling"
 *   Emotion Interpretation = EmotionProposal — "why, what's primary"
 *   Behavioral Tendency  = NOT in 002E (002F Decision Engine)
 */
import type {
  EmotionDimension,
  UserId,
  YaoYaoId,
} from "@yaoyao/domain";

/**
 * MAX_EMOTION_DELTA — Runtime Policy (NOT Core Constitution).
 * A single proposal may not move any emotion dimension by more than
 * this amount. The domain still enforces [0,1] bounds; this policy
 * prevents violent swings. Tunable without touching Core.
 */
export const MAX_EMOTION_DELTA = 0.3;

/**
 * Schema name for the interpreter's dedicated LLM call
 * (LLMRequest.outputSchemaName). The infrastructure adapter dispatches
 * on this name to validate against the emotion proposal schema.
 */
export const EMOTION_PROPOSAL_SCHEMA_NAME = "emotion-proposal-v1";

/**
 * EmotionProposal — the interpreter's output contract (§19).
 *
 * EVERY field is a proposal. The interpreter MUST NOT output a CoreState.
 * `signals` are proposed DELTAS in [-1, 1] (not absolute targets):
 * the domain transition computes newValue = clamp(current + delta, 0, 1).
 */
export interface EmotionProposal {
  /** Dominant emotion dimension, e.g. "hurt". */
  readonly primary: EmotionDimension;
  /** Co-occurring dimensions, e.g. ["affection"]. Multi-emotion coexistence (§10). */
  readonly secondary: ReadonlyArray<EmotionDimension>;
  /** Overall intensity of the emotional response [0, 1]. */
  readonly intensity: number;
  /** Per-dimension proposed deltas in [-1, 1]. */
  readonly signals: Partial<Record<EmotionDimension, number>>;
  /** Interpreter's confidence in this proposal [0, 1]. */
  readonly confidence: number;
  /** Machine-readable cause tag, e.g. "user_disagreement". Optional. */
  readonly cause?: string;
}

/**
 * Input to the EmotionInterpreter (§5). Built from the turn's situation —
 * the interpreter consumes Situation Understanding, it does not reimplement it.
 */
export interface EmotionInterpretationInput {
  readonly userId: UserId;
  readonly yaoyaoId: YaoYaoId;
  readonly currentInput: string;
  readonly situation: {
    readonly intent: string;
    readonly urgency: string;
    readonly taskNature: string;
  };
  readonly relationshipContext: {
    readonly type: string;
    readonly status: string;
  };
  /** Current 9-dim emotion values (Emotion State layer). */
  readonly currentEmotion: Record<EmotionDimension, number>;
  readonly recentConversation: ReadonlyArray<string>;
  /** Model-safe memory summaries from 002D (C4). */
  readonly relevantMemories: ReadonlyArray<string>;
  readonly traceId: string;
}

/**
 * Result of interpretation — the proposal plus call telemetry (§22).
 * The output is still "EmotionProposal, not CoreState" (§5); telemetry
 * is metadata for observability.
 */
export interface EmotionInterpretationResult {
  readonly proposal: EmotionProposal;
  readonly telemetry: {
    readonly providerId: string;
    readonly modelId: string;
    readonly latencyMs: number;
    readonly retryCount: number;
    readonly fallbackUsed: boolean;
  };
}

/**
 * EmotionInterpreter port — proposes, never persists.
 *
 * Implementations may call an LLM (via AI Router → LLMProvider), but the
 * output is ALWAYS an EmotionProposal. There is no path from this port
 * to any repository, transaction, or database.
 */
export interface EmotionInterpreter {
  interpret(input: EmotionInterpretationInput): Promise<EmotionInterpretationResult>;
}

/** NestJS injection token for the EmotionInterpreter port. */
export const EMOTION_INTERPRETER = "YAOYAO_EMOTION_INTERPRETER";

/**
 * Input to the transactional state write-back.
 * `deltas` must already have passed validation (the writer re-checks
 * domain bounds defensively via CoreState.transition).
 */
export interface EmotionWritebackInput {
  readonly userId: UserId;
  readonly yaoyaoId: YaoYaoId;
  /** Validated per-dimension deltas. */
  readonly deltas: Partial<Record<EmotionDimension, number>>;
  /** CAS expected version (loaded before interpretation). */
  readonly expectedVersion: number;
  /** Causation link for the STATE_CHANGED event. */
  readonly causationId?: string;
  readonly traceId: string;
}

export type EmotionWritebackResult =
  | {
      readonly outcome: "applied";
      readonly newVersion: number;
      readonly newEmotion: Record<EmotionDimension, number>;
      readonly eventId: string;
    }
  | {
      readonly outcome: "conflict";
      readonly expected: number;
      readonly current: number;
    }
  | {
      readonly outcome: "no-change";
    };

/**
 * EmotionStateWriter port — the ONLY path from a proposal to persisted state.
 *
 * Implemented in apps/api via TransactionManager.runAsUser:
 * load → domain transition → CAS → STATE_CHANGED → commit, atomically.
 * The runtime never touches repositories directly.
 */
export interface EmotionStateWriter {
  writeback(input: EmotionWritebackInput): Promise<EmotionWritebackResult>;
}

/** NestJS injection token for the EmotionStateWriter port. */
export const EMOTION_STATE_WRITER = "YAOYAO_EMOTION_STATE_WRITER";
