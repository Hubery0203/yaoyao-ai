/**
 * @yaoyao/application — YaoYao Core application layer.
 *
 * Use cases orchestrate domain aggregates through ports; this layer owns
 * authorization checks and transaction boundaries. It may depend on
 * @yaoyao/domain only — never on infrastructure, http, or apps.
 */
export * from "./ports/persistence/index.js";
export * from "./ports/security.js";
export * from "./ports/llm.js";
export * from "./ports/context-data.js";
export * from "./ports/memory-retrieval.js";
export * from "./ports/emotion.js";
export {
  initializeYaoYao,
  type InitializeYaoYaoInput,
  type InitializationResult,
} from "./usecases/initialize.js";
export {
  authenticateUser,
  refreshTokens,
  revokeRefreshSession,
  type AuthTokens,
} from "./usecases/auth.js";
export {
  registerUser,
  type RegisterUserInput,
  type RegisterUserResult,
} from "./usecases/register.js";
export {
  startSession,
  closeSession,
  type StartSessionInput,
  type StartSessionResult,
  type CloseSessionResult,
} from "./usecases/sessions.js";
export {
  getUserProfile,
  getYaoYaoIdentity,
  getCurrentState,
  getRelationship,
  listEvents,
  listMemories,
  listSessions,
  normalizePagination,
  type EventPage,
  type MemoryPage,
  type Pagination,
} from "./usecases/reads.js";
export {
  replayDiagnostics,
  type ReplayReadPort,
  type ReplayResult,
  type ReplayTraceEntry,
  type ReplayDiff,
} from "./usecases/replay.js";
export { applyEmotionProposal } from "./usecases/emotion.js";
