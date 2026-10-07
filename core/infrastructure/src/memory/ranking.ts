/**
 * Memory ranking — MVP-002D (pure functions, no I/O).
 *
 * Deterministic ranking policy (§IX — a Runtime Policy, NOT Core law):
 *
 *   FinalScore = Relevance × Importance × RecencyFactor
 *                × RelationshipFactor × Confidence − ConflictPenalty
 *
 * All functions are pure and deterministic: same inputs → same outputs.
 * Tie-breaks use memoryId ascending (§D15).
 *
 * This module never touches the database, never mutates, never generates.
 */
import type { MemoryType } from "@yaoyao/domain";

/** A memory candidate as loaded by the adapter (domain values only). */
export interface RankingCandidate {
  readonly memoryId: string;
  readonly content: string;
  readonly type: MemoryType;
  readonly importance: number;
  readonly confidence: number;
  readonly status: string;
  readonly version: number;
  /** memoryId this version supersedes (conflict chain), if any. */
  readonly supersedes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** 0..1 when the pgvector branch contributed; null when unused. */
  readonly semanticScore: number | null;
}

export interface RankingWeights {
  /** Half-life (days) for the recency decay. */
  readonly recencyHalfLifeDays: number;
  /** Per-type relationship factor (§XV). */
  readonly relationshipBoost: Record<MemoryType, number>;
  /** Penalty subtracted when a candidate loses a conflict pair. */
  readonly conflictPenalty: number;
  /** Jaccard threshold above which two candidates are near-duplicates. */
  readonly duplicateThreshold: number;
  /** Confidence below which the projection hedges ("可能记得…"). */
  readonly hedgeThreshold: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  recencyHalfLifeDays: 180,
  relationshipBoost: {
    CORE: 1.05,
    SEMANTIC: 0.95,
    EPISODIC: 1.0,
    SHARED_LIFE: 1.1,
  },
  conflictPenalty: 0.5,
  duplicateThreshold: 0.8,
  hedgeThreshold: 0.4,
};

export interface ScoredCandidate extends RankingCandidate {
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

// ---------------------------------------------------------------------------
// Query construction (§V, §VI)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  // Chinese stopwords
  "的", "了", "在", "是", "我", "你", "他", "她", "它", "们", "这", "那",
  "个", "和", "与", "或", "但", "而", "吗", "呢", "吧", "啊", "哦", "嗯",
  "什么", "怎么", "为什么", "哪里", "哪个", "多少", "很", "都", "也", "就",
  "不", "没", "有", "会", "可以", "要", "想", "去", "说", "知道", "觉得",
  // English stopwords
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "up", "down", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "all", "any", "both", "each", "few", "more", "most", "other",
  "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "s", "t", "just", "don", "now", "i", "me",
  "my", "myself", "we", "our", "ours", "you", "your", "yours", "he",
  "him", "his", "she", "her", "hers", "it", "its", "they", "them",
  "their", "what", "which", "who", "whom", "this", "that", "these",
  "those", "am", "an",
]);

/**
 * Extract search keywords from text. Handles mixed Chinese/English:
 * Chinese character sequences (≥2 chars) and alphanumeric words (≥2 chars),
 * minus stopwords. Deterministic.
 */
export function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  // Chinese sequences
  for (const m of text.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const kw = m[0];
    if (!STOPWORDS.has(kw)) keywords.push(kw);
  }
  // Alphanumeric words
  for (const m of text.matchAll(/[a-zA-Z0-9]{2,}/g)) {
    const kw = m[0].toLowerCase();
    if (!STOPWORDS.has(kw)) keywords.push(kw);
  }
  // Deduplicate, preserving order.
  return [...new Set(keywords)];
}

/**
 * Build the retrieval query from the full input contract (§VI).
 * The query is NOT the raw user input — it combines current input,
 * situation, relationship context, and recent conversation.
 */
export function buildQueryText(input: {
  currentInput: string;
  situation: { intent: string; urgency: string; taskNature: string };
  relationshipContext: { type: string; status: string };
  recentConversation: ReadonlyArray<string>;
}): string {
  const parts = [
    input.currentInput,
    input.situation.intent,
    input.situation.taskNature,
    ...input.recentConversation.slice(-3),
  ];
  return parts.filter((p) => p && p.trim().length > 0).join(" ");
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Normalized bigram set for similarity. Language-agnostic: works for
 * Chinese (character bigrams) and English (character bigrams of words).
 * Lower-cased, whitespace removed. Deterministic.
 */
export function textBigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  const bigrams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Bigram-Jaccard relevance [0,1] between the memory content and the
 * query text. Deterministic; Chinese-safe (no word segmentation needed).
 * Falls back to semanticScore when the pgvector branch contributed and
 * bigram overlap is zero.
 */
export function keywordRelevance(
  content: string,
  queryText: string,
  semanticScore: number | null,
): number {
  if (!queryText || queryText.trim().length === 0) {
    return semanticScore ?? 0.3;
  }
  const overlap = jaccardSets(textBigrams(content), textBigrams(queryText));
  // Blend with semantic when available; otherwise pure bigram overlap.
  return semanticScore !== null ? Math.max(overlap, semanticScore) : overlap;
}

/** Recency factor: exponential decay, 1.0 for brand-new memories (§XII). */
export function recencyFactor(updatedAt: Date, now: Date, halfLifeDays: number): number {
  const ageMs = Math.max(0, now.getTime() - updatedAt.getTime());
  const ageDays = ageMs / 86_400_000;
  return Math.exp(-ageDays / halfLifeDays);
}

/** Score a single candidate. Pure. */
export function scoreCandidate(
  candidate: RankingCandidate,
  queryText: string,
  weights: RankingWeights,
  now: Date,
): ScoredCandidate {
  const relevance = keywordRelevance(candidate.content, queryText, candidate.semanticScore);
  const importance = candidate.importance;
  const recency = recencyFactor(candidate.updatedAt, now, weights.recencyHalfLifeDays);
  const relationship = weights.relationshipBoost[candidate.type] ?? 1.0;
  const confidence = candidate.confidence;
  const score =
    relevance * importance * recency * relationship * confidence;
  return {
    ...candidate,
    signals: {
      relevance,
      importance,
      recency,
      relationship,
      confidence,
      conflictPenalty: 0,
    },
    score,
  };
}

// ---------------------------------------------------------------------------
// Conflict handling (§XI)
// ---------------------------------------------------------------------------

/**
 * Remove superseded versions: when candidates form a supersedes chain,
 * keep only the newest version (highest version number). The domain's
 * correct() already marks old versions CORRECTED (filtered by status),
 * but this is defense-in-depth for any chain that slips through.
 */
export function dedupeSupersedesChains(
  candidates: ReadonlyArray<ScoredCandidate>,
): ScoredCandidate[] {
  const byId = new Map(candidates.map((c) => [c.memoryId, c]));
  const supersededIds = new Set<string>();
  for (const c of candidates) {
    if (c.supersedes && byId.has(c.supersedes)) {
      supersededIds.add(c.supersedes);
    }
  }
  return candidates.filter((c) => !supersededIds.has(c.memoryId));
}

/**
 * Near-duplicate detection: two CONSOLIDATED/VALIDATED memories with
 * very high bigram overlap must not BOTH be served as certain facts.
 * The lower-scored one is dropped (conflictPenalty recorded for
 * observability before dropping).
 */
export function dropNearDuplicates(
  candidates: ReadonlyArray<ScoredCandidate>,
  weights: RankingWeights,
): ScoredCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: ScoredCandidate[] = [];
  const bigramSets = new Map<string, Set<string>>();
  for (const c of sorted) {
    const bigrams = textBigrams(c.content);
    bigramSets.set(c.memoryId, bigrams);
    let isDuplicate = false;
    for (const k of kept) {
      const sim = jaccardSets(bigrams, bigramSets.get(k.memoryId) ?? new Set());
      if (sim >= weights.duplicateThreshold) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push(c);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Selection + projection
// ---------------------------------------------------------------------------

/**
 * Full pipeline: score → dedupe chains → drop near-duplicates →
 * sort (score DESC, memoryId ASC tie-break — §D15) → take top N.
 * Pure and deterministic.
 */
export function rankAndSelect(
  candidates: ReadonlyArray<RankingCandidate>,
  queryText: string,
  weights: RankingWeights,
  now: Date,
  maxSelected: number,
): ScoredCandidate[] {
  const scored = candidates.map((c) => scoreCandidate(c, queryText, weights, now));
  const deduped = dedupeSupersedesChains(scored);
  const filtered = dropNearDuplicates(deduped, weights);
  filtered.sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));
  return filtered.slice(0, Math.max(0, maxSelected));
}

const TYPE_PREFIX: Record<MemoryType, string> = {
  SHARED_LIFE: "你们的共同回忆：",
  EPISODIC: "你们之前：",
  SEMANTIC: "记得用户提到：",
  CORE: "关于用户：",
};

/**
 * Project a scored memory to a model-safe summary (§XIV).
 * Contains ONLY human-readable text — no IDs, embeddings, scores,
 * audit fields, or ownership fields. Low-confidence memories are
 * hedged (§XVI) so the model cannot upgrade them to facts.
 */
export function projectSummary(
  memory: ScoredCandidate,
  weights: RankingWeights,
  maxChars: number,
): string {
  const hedged = memory.confidence < weights.hedgeThreshold;
  const prefix = hedged ? "可能" : "";
  const content = memory.content.length > maxChars
    ? memory.content.slice(0, maxChars) + "…"
    : memory.content;
  return `${prefix}${TYPE_PREFIX[memory.type]}${content}`;
}
