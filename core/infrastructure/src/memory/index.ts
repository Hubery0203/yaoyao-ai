/**
 * @yaoyao/infrastructure/memory — Memory Retrieval (MVP-002D).
 *
 * READ-ONLY: the adapter in this module issues SELECTs only.
 */
export {
  PostgresMemoryRetrievalAdapter,
  type MemoryRetrievalConfig,
} from "./retrieval.js";
export {
  buildQueryText,
  DEFAULT_RANKING_WEIGHTS,
  dropNearDuplicates,
  dedupeSupersedesChains,
  extractKeywords,
  keywordRelevance,
  projectSummary,
  rankAndSelect,
  recencyFactor,
  scoreCandidate,
  textBigrams,
  type RankingCandidate,
  type RankingWeights,
  type ScoredCandidate,
} from "./ranking.js";
