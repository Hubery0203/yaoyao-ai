/**
 * PostgresMemoryRetrievalAdapter — MVP-002D.
 *
 * Implements the MemoryRetrieval port against PostgreSQL (+ pgvector when
 * embeddings exist).
 *
 * READ-ONLY: this adapter issues SELECTs only. It never INSERTs, UPDATEs,
 * or DELETEs. In particular it never calls Memory.recordRecall() —
 * recall counters are a Memory System (later phase) concern, and D10
 * requires count/version/updated_at to be unchanged by retrieval.
 *
 * Owner isolation (§VIII): every query is scoped by
 * (user_id, yaoyao_id). The yaoyaoId comes from the server-resolved
 * PersonaData, never from client input. Existing RLS (app.user_id)
 * applies on top via the transaction manager.
 *
 * Retrieval strategy (§VII, §XXIII):
 *  1. Structured: owner scope + status IN (VALIDATED, CONSOLIDATED).
 *     CANDIDATE (not yet long-term), CORRECTED (superseded), and
 *     ARCHIVED are never candidates.
 *  2. Keyword relevance in TypeScript (deterministic, Chinese-safe).
 *  3. Recency + importance as multiplicative factors.
 *  4. pgvector semantic branch: used ONLY when non-NULL embeddings
 *     exist AND a query embedding is supplied. 002D has no embedding
 *     model, so this branch is an extension point (telemetry reports
 *     semanticUsed=false). The system works fully without it.
 */
import {
  type MemoryRetrieval,
  type MemoryRetrievalInput,
  type RelevantMemoryContext,
  type RetrievedMemory,
} from "@yaoyao/application";
import type { MemoryType } from "@yaoyao/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../postgres/db.js";
import { memories } from "../postgres/schema/index.js";
import { numericToNumber } from "../postgres/mappers/primitives.js";
import {
  buildQueryText,
  DEFAULT_RANKING_WEIGHTS,
  projectSummary,
  rankAndSelect,
  type RankingCandidate,
  type RankingWeights,
} from "./ranking.js";

export interface MemoryRetrievalConfig {
  /** Coarse candidate pool size from SQL (default 50). */
  readonly maxCandidates?: number;
  /** Final selected memories (default 5 — C4 budget). */
  readonly maxSelected?: number;
  /** Per-summary character cap (default 200). */
  readonly maxSummaryChars?: number;
  /** Ranking policy knobs (Runtime Policy — not Core law). */
  readonly weights?: Partial<RankingWeights>;
  /**
   * Optional query-embedding producer for the pgvector branch.
   * Absent in 002D (no embedding model in scope) — the branch then
   * contributes zero candidates and telemetry reports semanticUsed=false.
   */
  readonly embedQuery?: (text: string) => Promise<number[] | null>;
}

const RETRIEVABLE_STATUSES = ["VALIDATED", "CONSOLIDATED"] as const;

export class PostgresMemoryRetrievalAdapter implements MemoryRetrieval {
  private readonly maxCandidates: number;
  private readonly maxSelected: number;
  private readonly maxSummaryChars: number;
  private readonly weights: RankingWeights;
  private readonly embedQuery?: (text: string) => Promise<number[] | null>;

  constructor(
    private readonly db: Db,
    config: MemoryRetrievalConfig = {},
  ) {
    this.maxCandidates = config.maxCandidates ?? 50;
    this.maxSelected = config.maxSelected ?? 5;
    this.maxSummaryChars = config.maxSummaryChars ?? 200;
    this.weights = { ...DEFAULT_RANKING_WEIGHTS, ...config.weights };
    this.embedQuery = config.embedQuery;
  }

  async retrieve(
    input: MemoryRetrievalInput,
  ): Promise<RelevantMemoryContext> {
    const started = Date.now();
    const now = new Date();

    // 1. Build the query from the full input contract (§VI) — never the
    //    raw user input alone.
    const queryText = buildQueryText(input);

    // 2. Candidate retrieval: owner-scoped, status-filtered, coarse order
    //    by importance/recency. Keyword scoring happens in TypeScript
    //    (deterministic, Chinese-safe).
    const rows = await this.db
      .select({
        memoryId: memories.memoryId,
        content: memories.content,
        type: memories.type,
        importance: memories.importance,
        confidence: memories.confidence,
        status: memories.status,
        version: memories.version,
        supersedes: memories.supersedes,
        createdAt: memories.createdAt,
        updatedAt: memories.updatedAt,
      })
      .from(memories)
      .where(
        and(
          eq(memories.userId, input.userId as string),
          eq(memories.yaoyaoId, input.yaoyaoId as string),
          inArray(memories.status, [...RETRIEVABLE_STATUSES]),
        ),
      )
      .orderBy(desc(memories.importance), desc(memories.updatedAt))
      .limit(input.limit > 0 ? Math.min(input.limit, this.maxCandidates) : this.maxCandidates);
    const retrievalLatencyMs = Date.now() - started;

    // 3. Semantic branch (extension point — §XXIII).
    let semanticUsed = false;
    const semanticScores = new Map<string, number>();
    if (this.embedQuery) {
      const queryEmbedding = await this.embedQuery(queryText).catch(() => null);
      if (queryEmbedding) {
        const semRows = await this.semanticCandidates(
          input,
          queryEmbedding,
        ).catch(() => []);
        for (const r of semRows) {
          semanticScores.set(r.memoryId, r.similarity);
        }
        semanticUsed = semRows.length > 0;
      }
    }

    // 4. Rank (pure, deterministic).
    const rankStarted = Date.now();
    const candidates: RankingCandidate[] = rows.map((row) => ({
      memoryId: row.memoryId,
      content: row.content,
      type: row.type as MemoryType,
      importance: numericToNumber(row.importance, "importance", "memories"),
      confidence: numericToNumber(row.confidence, "confidence", "memories"),
      status: row.status,
      version: row.version,
      supersedes: row.supersedes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      semanticScore: semanticScores.get(row.memoryId) ?? null,
    }));
    // Merge any semantic-only candidates not in the structured pool.
    // (In 002D this set is empty — the branch is an extension point.)
    const selected = rankAndSelect(
      candidates,
      queryText,
      this.weights,
      now,
      this.maxSelected,
    );
    const rankingLatencyMs = Date.now() - rankStarted;

    // 5. Project to model-safe summaries (§XIV).
    const projected: RetrievedMemory[] = selected.map((s) => ({
      memoryId: s.memoryId,
      summary: projectSummary(s, this.weights, this.maxSummaryChars),
      importance: s.importance,
      confidence: s.confidence,
      type: s.type,
      signals: { ...s.signals },
      score: s.score,
    }));

    return {
      memories: projected,
      telemetry: {
        requestId: input.traceId,
        candidateCount: rows.length,
        selectedCount: projected.length,
        retrievalLatencyMs,
        rankingLatencyMs,
        semanticUsed,
      },
    };
  }

  /**
   * pgvector semantic candidates. Only reached when an embedQuery
   * producer is configured (not in 002D). Cosine similarity via
   * the <=> operator; owner-scoped like everything else.
   */
  private async semanticCandidates(
    input: MemoryRetrievalInput,
    queryEmbedding: number[],
  ): Promise<Array<{ memoryId: string; similarity: number }>> {
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;
    const rows = await this.db.execute(sql`
      SELECT memory_id AS "memoryId",
             1 - (embedding <=> ${embeddingLiteral}::vector) AS "similarity"
      FROM memories
      WHERE user_id = ${input.userId as string}
        AND yaoyao_id = ${input.yaoyaoId as string}
        AND status IN ('VALIDATED', 'CONSOLIDATED')
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${this.maxCandidates}
    `);
    const result: Array<{ memoryId: string; similarity: number }> = [];
    const raw = rows as unknown as { rows?: Array<{ memoryId: string; similarity: number }> }
      | Array<{ memoryId: string; similarity: number }>;
    const list = Array.isArray(raw) ? raw : (raw.rows ?? []);
    for (const r of list) {
      if (typeof r.similarity === "number" && r.similarity > 0.5) {
        result.push({ memoryId: r.memoryId, similarity: r.similarity });
      }
    }
    return result;
  }
}
