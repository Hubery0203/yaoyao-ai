/**
 * MemoryRetrieval port — MVP-002D Memory Retrieval.
 *
 * READ-ONLY by contract. This port may SELECT, SEARCH, RANK, FILTER,
 * SELECT, and PROJECT memories. It MUST NOT create, update, delete,
 * consolidate, supersede, or otherwise modify any memory.
 *
 * Retrieval = Selection, never Generation (D14): if the database has no
 * matching memory, the result is empty — never synthesized.
 *
 * The runtime depends ONLY on this interface. The infrastructure adapter
 * (PostgreSQL / pgvector) implements it. The runtime never touches
 * Drizzle, pgvector, or SQL.
 */
import type {
  MemoryType,
  UserId,
  YaoYaoId,
} from "@yaoyao/domain";

/**
 * Query contract — §VI. The query is built from the current situation,
 * NOT from the raw user input alone ("用户说的话 ≠ 用户真正正在谈论的事情").
 * 002D consumes Situation Understanding results; it does not reimplement it.
 */
export interface MemoryRetrievalInput {
  readonly userId: UserId;
  /** Server-resolved YaoYao identity — never trusted from the client (§VIII). */
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
  /** Recent conversation turns (empty until Migration 0003 populates C6). */
  readonly recentConversation: ReadonlyArray<string>;
  /** Max candidates to consider before ranking. */
  readonly limit: number;
  readonly traceId: string;
}

/**
 * A single retrieved memory — a PROJECTION, never the raw entity (§XIV).
 * `memoryId` and `signals` exist for observability/debugging only;
 * they are NEVER rendered into model-visible prompt text.
 */
export interface RetrievedMemory {
  /** Internal ID — observability only, never in prompt text. */
  readonly memoryId: string;
  /** Human-readable, model-safe summary. No IDs, embeddings, scores, or audit fields. */
  readonly summary: string;
  readonly importance: number;
  readonly confidence: number;
  readonly type: MemoryType;
  /** Per-signal breakdown — observability only, never in prompt text. */
  readonly signals: {
    readonly relevance: number;
    readonly importance: number;
    readonly recency: number;
    readonly relationship: number;
    readonly confidence: number;
    readonly conflictPenalty: number;
  };
  readonly score: number;
}

/** Performance telemetry — §XXII. */
export interface MemoryRetrievalTelemetry {
  readonly requestId: string;
  readonly candidateCount: number;
  readonly selectedCount: number;
  readonly retrievalLatencyMs: number;
  readonly rankingLatencyMs: number;
  /** Whether the pgvector semantic branch contributed candidates. */
  readonly semanticUsed: boolean;
}

export interface RelevantMemoryContext {
  readonly memories: ReadonlyArray<RetrievedMemory>;
  readonly telemetry: MemoryRetrievalTelemetry;
}

export interface MemoryRetrieval {
  retrieve(input: MemoryRetrievalInput): Promise<RelevantMemoryContext>;
}

/** NestJS injection token for the MemoryRetrieval port. */
export const MEMORY_RETRIEVAL = "YAOYAO_MEMORY_RETRIEVAL";

/**
 * Empty (no-op) MemoryRetrieval — used when no adapter is wired
 * (unit tests, environments without memory data). Returns no memories;
 * never fails, never hallucinates.
 */
export class EmptyMemoryRetrieval implements MemoryRetrieval {
  async retrieve(input: MemoryRetrievalInput): Promise<RelevantMemoryContext> {
    return {
      memories: [],
      telemetry: {
        requestId: input.traceId,
        candidateCount: 0,
        selectedCount: 0,
        retrievalLatencyMs: 0,
        rankingLatencyMs: 0,
        semanticUsed: false,
      },
    };
  }
}
