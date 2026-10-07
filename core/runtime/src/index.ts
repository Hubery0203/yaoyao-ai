/**
 * @yaoyao/runtime — YaoYao Core conversation runtime (MVP-002).
 *
 * Canonical 10-step pipeline orchestration. Depends on @yaoyao/application
 * ports and @yaoyao/domain only — never infrastructure, http, apps, or
 * vendor SDKs (enforced by dependency-cruiser).
 */
export {
  CANONICAL_STEP_ORDER,
  CONVERSATION_ORCHESTRATOR,
  ConversationOrchestrator,
  type OrchestratorDeps,
  type PipelineStep,
} from "./conversation/orchestrator.js";
export type {
  PendingUserMessage,
  TurnInput,
  TurnOutput,
} from "./conversation/types.js";
export type { RuntimeTrace } from "./contracts/trace.js";
export {
  ProposalValidationError,
  markValidated,
  validateProposalMinimal,
  type ValidatedProposal,
} from "./validation/minimal.js";
export { MockLLMProvider } from "./testing/mock-provider.js";
