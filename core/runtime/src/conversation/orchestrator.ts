/**
 * ConversationOrchestrator — Canonical Runtime 10-step pipeline (MVP-002B).
 *
 * Frozen pipeline (§5), implemented exactly:
 *
 *   1. User Input              → validated at API boundary (Zod DTO)
 *   2. Event Creation          → pending in-memory PendingUserMessage (NOT persisted)
 *   3. Situation Understanding → skeleton: fixed classification (real logic in later phase)
 *   4. Context Assembly        → Persona Runtime + C0–C7 + budget (MVP-002B: REAL)
 *   5. Decision                → skeleton: fixed default (real engine in 002F)
 *   6. LLM Generation          → via the LLMProvider port (Mock in 002A/B)
 *   7. Behavior Validation     → minimal structural gate (full pipeline in 002F)
 *   8. State / Memory Processing → skeleton NO-OP (I-016; real write-back in 002E)
 *   9. Response Delivery       → unwrap response proposal (ONLY unwrap site)
 *   10. Event Recording        → skeleton (event types arrive with Migration 0003)
 *
 * MVP-002B changes vs 002A:
 * - Step 4 is now REAL: loads PersonaData via ContextDataPort, runs the
 *   Persona Runtime (read-only projection), assembles C0–C7 with the token
 *   budget allocator, and builds the System/Context prompt.
 * - TD-M002A-001 FIXED: the real yaoyaoId is resolved from the
 *   authenticated user via loadPersonaData — no more "00000000-..." placeholder.
 *
 * I-016: the orchestrator holds no repository, no transaction manager, no
 * database client. Step 8 performs zero writes.
 */
import {
  EmptyMemoryRetrieval,
  unwrapProposal,
  type ContextDataPort,
  type LLMRequest,
  type MemoryRetrieval,
  type RuntimeDecision,
} from "@yaoyao/application";
import type { UserId, YaoYaoId } from "@yaoyao/domain";
import { randomUUID } from "node:crypto";
import { ContextAssembler } from "../context/assembly.js";
import { createTrace } from "../contracts/trace.js";
import { validateProposalMinimal } from "../validation/minimal.js";
import { AIRouter } from "../router/router.js";
import { ResilientLLMInvoker } from "../router/resilient.js";
import type { PendingUserMessage, TurnInput, TurnOutput } from "./types.js";

export interface OrchestratorDeps {
  readonly router: AIRouter;
  readonly contextData: ContextDataPort;
  /**
   * MVP-002D: Memory Retrieval port. Optional — defaults to the empty
   * (no-op) retrieval so unit tests and non-memory environments keep
   * working. Production wiring injects the Postgres adapter.
   */
  readonly memoryRetrieval?: MemoryRetrieval;
}

/** NestJS injection token for the ConversationOrchestrator. */
export const CONVERSATION_ORCHESTRATOR = "YAOYAO_CONVERSATION_ORCHESTRATOR";

/** The frozen 10-step pipeline order. */
export type PipelineStep =
  | "user-input"
  | "event-creation"
  | "situation-understanding"
  | "context-assembly"
  | "decision"
  | "llm-generation"
  | "behavior-validation"
  | "state-memory-processing"
  | "response-delivery"
  | "event-recording";

/** The frozen 10-step order. Exported for tests to assert against. */
export const CANONICAL_STEP_ORDER: ReadonlyArray<PipelineStep> = [
  "user-input",
  "event-creation",
  "situation-understanding",
  "context-assembly",
  "decision",
  "llm-generation",
  "behavior-validation",
  "state-memory-processing",
  "response-delivery",
  "event-recording",
];

export class ConversationOrchestrator {
  private readonly assembler = new ContextAssembler();

  constructor(private readonly deps: OrchestratorDeps) {}

  async converse(input: TurnInput): Promise<TurnOutput> {
    const trace = createTrace(input.traceId, input.userId);
    const executedSteps: PipelineStep[] = [];

    // Step 1 — User Input: already validated at the API boundary (Zod DTO).
    executedSteps.push("user-input");

    // Step 2 — Event Creation: construct + validate the pending event IN MEMORY.
    const pending = this.createPendingEvent(input);
    (trace as { eventCreation?: unknown }).eventCreation = {
      messageId: pending.messageId,
      correlationId: pending.correlationId,
      status: "pending",
    };
    executedSteps.push("event-creation");

    // Step 3 — Situation Understanding (skeleton).
    const situation = { intent: "chat", urgency: "normal", taskNature: "general" };
    (trace as { situation?: unknown }).situation = situation;
    executedSteps.push("situation-understanding");

    // Step 4 — Context Assembly (REAL in MVP-002B; C4 live in 002D).
    // Load PersonaData (read-only) → Memory Retrieval (read-only) →
    // Persona Runtime → C0–C7 → budget.
    const personaData = await this.deps.contextData.loadPersonaData(
      input.userId as UserId,
    );
    // MVP-002D: retrieve relevant memories. The yaoyaoId is server-resolved
    // from PersonaData (§VIII) — never trusted from client input.
    // recentConversation is empty until Migration 0003 populates C6.
    const memoryRetrieval = this.deps.memoryRetrieval ?? new EmptyMemoryRetrieval();
    const memoryContext = await memoryRetrieval.retrieve({
      userId: input.userId as UserId,
      yaoyaoId: personaData.yaoyao.yaoyaoId as YaoYaoId,
      currentInput: input.text,
      situation: {
        intent: situation.intent,
        urgency: situation.urgency,
        taskNature: situation.taskNature,
      },
      relationshipContext: {
        type: personaData.relationship.type,
        status: personaData.relationship.status,
      },
      recentConversation: [],
      limit: 50,
      traceId: input.traceId,
    });
    const assembled = this.assembler.assemble({
      data: personaData,
      inputText: input.text,
      memoryContext,
    });
    (trace as { context?: unknown }).context = {
      layersIncluded: [...assembled.promptContext.layersIncluded],
      layersDropped: [...assembled.promptContext.layersDropped],
      estimatedInputTokens: assembled.promptContext.estimatedInputTokens,
      reservedOutputTokens: assembled.promptContext.reservedOutputTokens,
      totalBudget: assembled.promptContext.totalBudget,
      memoryRetrieved: memoryContext.memories.length,
      memoryTelemetry: memoryContext.telemetry,
    };
    executedSteps.push("context-assembly");

    // Step 5 — Decision (skeleton: fixed default; real engine in 002F).
    const decision: RuntimeDecision = {
      primaryIntent: "answer",
      conversationMode: "normal",
    };
    (trace as { decision?: unknown }).decision = decision;
    executedSteps.push("decision");

    // Step 6 — LLM Generation: router selects the provider for this turn
    // (task=conversation → L2), then the resilient invoker handles
    // retry/fallback. The runtime never touches a vendor SDK.
    const selected = this.deps.router.select({
      task: "conversation",
      fallbackAllowed: true,
    });
    const invoker = new ResilientLLMInvoker(
      selected.provider,
      this.deps.router.fallbackProvider(),
    );
    const llmRequest: LLMRequest = {
      userId: input.userId as UserId,
      yaoyaoId: assembled.yaoyaoId as never,
      systemContext: assembled.promptContext.systemPrompt,
      conversationContext: assembled.promptContext.contextText,
      userInput: input.text,
      decision,
      outputSchemaName: "llm-output-contract-v1",
      timeoutMs: 30_000,
      metadata: {
        runtimeVersion: "mvp-002c",
        contextVersion: "c0-c7-v1",
        requestId: input.traceId,
      },
    };
    const { proposal, telemetry } = await invoker.invoke(llmRequest);
    (trace as { llm?: unknown }).llm = {
      providerId: telemetry.providerId,
      modelId: telemetry.modelId,
      latencyMs: telemetry.latencyMs,
      retryCount: telemetry.retryCount,
      fallbackUsed: telemetry.fallbackUsed,
      routingReason: selected.reason,
    };
    executedSteps.push("llm-generation");

    // Step 7 — Behavior Validation: minimal structural gate (full in 002F).
    const validated = validateProposalMinimal(proposal);
    (trace as { validation?: unknown }).validation = {
      stagesPassed: ["minimal-structure"],
      repairs: 0,
      fallbackTriggered: false,
    };
    executedSteps.push("behavior-validation");

    // Step 8 — State / Memory Processing: SKELETON NO-OP.
    // I-016: zero writes. Real write-back arrives in 002E.
    (trace as { writeback?: unknown }).writeback = {
      stateChanged: false,
      eventsCommitted: 0,
      note: "skeleton: no writes in MVP-002B (I-016: no Proposal→save path exists)",
    };
    executedSteps.push("state-memory-processing");

    // Step 9 — Response Delivery: the ONLY legal unwrap site.
    const response = unwrapProposal(validated.response);
    executedSteps.push("response-delivery");

    // Step 10 — Event Recording: skeleton (Migration 0003 deferred).
    (trace as { eventRecording?: unknown }).eventRecording = {
      status: "skipped-skeleton",
      note: "USER_MESSAGE/ASSISTANT_MESSAGE persistence arrives with Migration 0003",
    };
    executedSteps.push("event-recording");

    (trace as { steps?: unknown }).steps = executedSteps;
    (trace as { finishedAt?: unknown }).finishedAt = new Date().toISOString();

    return { response, trace };
  }

  private createPendingEvent(input: TurnInput): PendingUserMessage {
    const correlationId = randomUUID();
    return {
      messageId: randomUUID(),
      correlationId,
      userId: input.userId,
      text: input.text,
      occurredAt: new Date().toISOString(),
    };
  }
}
