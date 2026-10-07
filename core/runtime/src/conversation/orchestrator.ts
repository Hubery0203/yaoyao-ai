/**
 * ConversationOrchestrator — Canonical Runtime 10-step pipeline skeleton (MVP-002A).
 *
 * Frozen pipeline (§5), implemented exactly — no reordering, no skipped
 * steps, no parallel runtime:
 *
 *   1. User Input
 *   2. Event Creation        → pending in-memory PendingUserMessage (NOT persisted in 002A)
 *   3. Situation Understanding → skeleton: fixed classification
 *   4. Context Assembly      → skeleton: minimal context (input text only)
 *   5. Decision              → skeleton: fixed default decision
 *   6. LLM Generation        → via the LLMProvider port (Mock in 002A)
 *   7. Behavior Validation   → minimal structural gate
 *   8. State / Memory Processing → skeleton: NO-OP (I-016 gate documented; no writes)
 *   9. Response Delivery     → unwrap response proposal (the ONLY unwrap site)
 *   10. Event Recording      → skeleton: recorded in trace as deferred
 *
 * I-016 is structural from day one: the orchestrator holds no repository,
 * no transaction manager, no database client. It CANNOT write — the only
 * persistence-adjacent step (8) is an explicit no-op with a comment
 * pointing at the future write-back design (proposal §M).
 *
 * Later phases fill in the skeletons: 002B (context), 002D (memory
 * retrieval), 002E (emotion + write-back), 002F (decision + validation).
 */
import {
  unwrapProposal,
  type LLMProvider,
  type LLMRequest,
  type RuntimeDecision,
} from "@yaoyao/application";
import { randomUUID } from "node:crypto";
import { createTrace } from "../contracts/trace.js";
import { validateProposalMinimal } from "../validation/minimal.js";
import type { PendingUserMessage, TurnInput, TurnOutput } from "./types.js";

export interface OrchestratorDeps {
  readonly llm: LLMProvider;
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
  constructor(private readonly deps: OrchestratorDeps) {}

  async converse(input: TurnInput): Promise<TurnOutput> {
    const trace = createTrace(input.traceId, input.userId);
    const executedSteps: PipelineStep[] = [];

    // Step 1 — User Input: already validated at the API boundary (Zod DTO).
    executedSteps.push("user-input");

    // Step 2 — Event Creation: construct + validate the pending event IN MEMORY.
    // No DB write in MVP-002A (event types arrive with Migration 0003).
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

    // Step 4 — Context Assembly (skeleton: input text only).
    (trace as { context?: unknown }).context = {
      layersIncluded: ["C7"],
      inputTextLength: input.text.length,
    };
    executedSteps.push("context-assembly");

    // Step 5 — Decision (skeleton: fixed default; real engine in 002F).
    const decision: RuntimeDecision = {
      primaryIntent: "answer",
      conversationMode: "normal",
    };
    (trace as { decision?: unknown }).decision = decision;
    executedSteps.push("decision");

    // Step 6 — LLM Generation: via the port. Runtime never touches a vendor SDK.
    const llmRequest: LLMRequest = {
      // userId/yaoyaoId are typed as domain IDs; the skeleton carries the
      // authenticated userId through. yaoyaoId resolution arrives with 002B.
      userId: input.userId as never,
      yaoyaoId: "00000000-0000-0000-0000-000000000000" as never,
      context: { inputText: input.text, decision },
      outputSchemaName: "llm-output-contract-v1",
      timeoutMs: 30_000,
      traceId: input.traceId,
    };
    const started = Date.now();
    const proposal = await this.deps.llm.generate(llmRequest);
    (trace as { llm?: unknown }).llm = {
      providerId: this.deps.llm.providerId,
      modelId: this.deps.llm.modelId,
      latencyMs: Date.now() - started,
      fallbackUsed: false,
    };
    executedSteps.push("llm-generation");

    // Step 7 — Behavior Validation: minimal structural gate (full pipeline in 002F).
    const validated = validateProposalMinimal(proposal);
    (trace as { validation?: unknown }).validation = {
      stagesPassed: ["minimal-structure"],
      repairs: 0,
      fallbackTriggered: false,
    };
    executedSteps.push("behavior-validation");

    // Step 8 — State / Memory Processing: SKELETON NO-OP in MVP-002A.
    // I-016: this step deliberately performs zero writes. The validated
    // proposal is NOT passed to any repository — the orchestrator holds
    // none. Real write-back (proposal → validation → domain transition →
    // CAS) arrives in 002E.
    (trace as { writeback?: unknown }).writeback = {
      stateChanged: false,
      eventsCommitted: 0,
      note: "skeleton: no writes in MVP-002A (I-016: no Proposal→save path exists)",
    };
    executedSteps.push("state-memory-processing");

    // Step 9 — Response Delivery: the ONLY legal unwrap site for the
    // response proposal. Unwrapping here produces client output, never
    // persistence.
    const response = unwrapProposal(validated.response);
    executedSteps.push("response-delivery");

    // Step 10 — Event Recording: skeleton. No event types in the domain
    // catalog yet (Migration 0003 deferred per authorization); the pending
    // event's lifecycle is recorded in the trace.
    (trace as { eventRecording?: unknown }).eventRecording = {
      status: "skipped-skeleton",
      note: "USER_MESSAGE/ASSISTANT_MESSAGE persistence arrives with Migration 0003",
    };
    executedSteps.push("event-recording");

    // The trace records the executed step order for pipeline-order tests.
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
