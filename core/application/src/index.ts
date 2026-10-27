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
export * from "./ports/decision.js";
export * from "./ports/conversation.js";
export * from "./ports/continuity.js";
export * from "./ports/continuity-processing.js";
export * from "./ports/temporal-emotion.js";
export * from "./usecases/continuity.js";
export * from "./usecases/temporal-emotion.js";
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
export {
  persistUserMessage,
  persistAssistantMessage,
  loadConversationHistory,
  findCompletedTurn,
} from "./usecases/conversation.js";
export * from "./usecases/memory-review.js";
export * from "./usecases/memory-management.js";

export * from "./weixin.js";
export * from './weixin-policy.js';
export {recordAcceptedOutreach} from './usecases/outreach.js';
export * from './experience.js';
export * from './usecases/experience.js';
export {handleWeixinMemoryCommand} from './usecases/weixin-memory.js';
export {photoRequest,PHOTO_CAPTION,PHOTO_FAILURE,PHOTO_FAILURE_CODES,photoFailureMessage,photoControl,PHOTO_HELP,type PhotoFailureCode} from './photos.js';
export {recordPhotoResponse} from './usecases/photo-history.js';

export * from './companion-commands.js';
export {handleWeixinCompanionCommand} from './usecases/weixin-companion.js';
export * from './outreach-commands.js';

export * from './voice.js';

export * from './vision.js';
export * from './usecases/incoming-image-history.js';
