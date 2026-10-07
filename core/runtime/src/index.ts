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
export { AIRouter, type RouterConfig, type RoutingInput, type SelectedModel } from "./router/router.js";
export {
  ResilientLLMInvoker,
  type ResilienceConfig,
  type ResilientResult,
} from "./router/resilient.js";
export { RouterEmotionInterpreter } from "./emotion/interpreter.js";
export {
  validateEmotionProposal,
  type ValidationOutcome,
} from "./emotion/validation.js";
export { estimateUsage, DEFAULT_PRICING, type ModelPricing, type PricingTable } from "./router/usage.js";
export { PersonaRuntime } from "./persona/persona-runtime.js";
export {
  RUNTIME_BEHAVIORAL_CONSTRAINTS,
  renderConstraints,
} from "./persona/constraints.js";
export { ContextAssembler } from "./context/assembly.js";
export {
  allocateBudget,
  estimateTokens,
  makeLayer,
  type BudgetConfig,
  type BudgetResult,
} from "./context/budget.js";
export type {
  ContextLayer,
  ContextLayerId,
  ContextPriority,
  ConversationTurn,
  PromptContext,
  RecentEventProjection,
  RelevantMemoryContext,
} from "./context/layers.js";
