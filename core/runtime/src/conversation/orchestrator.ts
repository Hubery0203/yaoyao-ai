import {renderTurnVariety} from './naturalness.js';
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
  type ContextDataPort,
  type ConversationEventPort,
  type EmotionInterpreter,
  type EmotionStateWriter,
  type LLMRequest,
  type MemoryRetrieval,
} from "@yaoyao/application";
import {
  EMOTION_DIMENSIONS,
  type EmotionDimension,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { randomUUID } from "node:crypto";
import {estimateTokens} from "../context/budget.js";
import { ContextAssembler } from "../context/assembly.js";
import { createTrace } from "../contracts/trace.js";
import { DecisionEngine, renderDecisionGuidance } from "../decision/engine.js";
import { validateEmotionProposal } from "../emotion/validation.js";
import {
  buildFallbackResponse,
  buildRepairInstruction,
  validateResponse,
} from "../validation/response.js";
import { AIRouter } from "../router/router.js";
import { ResilientLLMInvoker } from "../router/resilient.js";
import type { PendingUserMessage, TurnInput, TurnOutput } from "./types.js";
import {renderConversationContinuity} from "./continuity.js";
import {experienceForTurn,renderCompanionExperience,groundedLifeReply} from "./experience.js";
import {conversationStyle} from './style.js';
import {projectTurnMemories,focusDisclosureHistory,selectedMemoryEvidence} from './memory-context.js';
import {validationFailureSummary} from "./quality.js";
import { classifySituation } from "./situation.js";

export interface OrchestratorDeps {
  readonly modelBudgetMs?:number;
  readonly maxOutputTokens?:number;
  readonly temporalEmotion?: import("@yaoyao/application").TemporalEmotionWriter;
  readonly router: AIRouter;
  readonly contextData: ContextDataPort;
  /**
   * MVP-002D: Memory Retrieval port. Optional — defaults to the empty
   * (no-op) retrieval so unit tests and non-memory environments keep
   * working. Production wiring injects the Postgres adapter.
   */
  readonly memoryRetrieval?: MemoryRetrieval;
  /**
   * MVP-002E: Emotion Interpreter port. Optional — when absent, Step 8
   * records "skipped: no interpreter wired" and performs no write-back.
   * Production wiring injects RouterEmotionInterpreter.
   */
  readonly emotionInterpreter?: EmotionInterpreter;
  /**
   * MVP-002E: Emotion State Writer port. Optional — when absent, validated
   * proposals are not persisted. Production wiring injects
   * TransactionalEmotionWriter.
   */
  readonly emotionWriter?: EmotionStateWriter;
  /**
   * MVP-002G: Conversation event port (USER_MESSAGE/ASSISTANT_MESSAGE
   * persistence + C6 history). Optional — when absent, Steps 1/2/10
   * keep their in-memory behavior and C6 stays empty. Production wiring
   * injects TransactionalConversationEvents.
   */
  readonly conversationEvents?: ConversationEventPort;
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
    const measurements={completedInvocations:0,failedInvocations:0,knownProviderAttempts:0,usageSamples:0,successfulInputTokens:0,successfulOutputTokens:0,contextMs:0,emotionMs:0,historyIncluded:0,historyDropped:0,historyNewestTruncated:false,estimatedContextTokens:0,emotionBudgetSkipped:false};
    (trace as {performance?:unknown}).performance=measurements;
    const recordModel=(t:{attempts?:number;retryCount:number;fallbackUsed:boolean;successfulUsage?:{inputTokens:number;outputTokens:number}})=>{measurements.completedInvocations++;measurements.knownProviderAttempts+=t.attempts??(t.retryCount+1+(t.fallbackUsed?1:0));if(t.successfulUsage){measurements.usageSamples++;measurements.successfulInputTokens+=t.successfulUsage.inputTokens;measurements.successfulOutputTokens+=t.successfulUsage.outputTokens;}};
    const executedSteps: PipelineStep[] = [];
    const requestId = input.requestId ?? randomUUID();
    const conversationEvents = this.deps.conversationEvents;

    // Step 1 — User Input: already validated at the API boundary (Zod DTO).
    executedSteps.push("user-input");

    // Persona data is needed early (idempotency check needs yaoyaoId).
    // Loaded once, reused by Steps 2, 4, 8.
    let personaData = await this.deps.contextData.loadPersonaData(
      input.userId as UserId,
    );
    const yaoyaoId = personaData.yaoyao.yaoyaoId as YaoYaoId;

    // Step 2 — Event Creation (REAL in MVP-002G).
    // Idempotency first: if this requestId already completed, return the
    // stored response without re-running the turn (G25).
    const pending = this.createPendingEvent(input);
    if (conversationEvents) {
      const replay = await conversationEvents.findCompletedTurn({
        userId: input.userId as never,
        yaoyaoId: yaoyaoId as never,
        requestId,
        text:input.text,
      });
      if (replay !== null) {
        (trace as { eventCreation?: unknown }).eventCreation = {
          messageId: pending.messageId,
          correlationId: pending.correlationId,
          status: "idempotent-replay",
          requestId,
        };
        executedSteps.push("event-creation");
        (trace as { steps?: unknown }).steps = executedSteps;
        (trace as { finishedAt?: unknown }).finishedAt = new Date().toISOString();
        return { response: replay, trace };
      }
      // Tx1a: persist USER_MESSAGE (idempotent on requestId).
      const persisted = await conversationEvents.persistUserMessage({
        userId: input.userId as never,
        yaoyaoId: yaoyaoId as never,
        sessionId: input.sessionId ?? null,
        text: input.text,
        requestId,
        traceId: input.traceId,
      });
      (trace as { eventCreation?: unknown }).eventCreation = {
        messageId: pending.messageId,
        correlationId: pending.correlationId,
        status: persisted.duplicate ? "duplicate-suppressed" : "persisted",
        requestId,
        userMessageEventId: persisted.eventId,
      };
    } else {
      (trace as { eventCreation?: unknown }).eventCreation = {
        messageId: pending.messageId,
        correlationId: pending.correlationId,
        status: "pending",
        requestId,
      };
    }
    executedSteps.push("event-creation");
    // Explicit command after completed-turn replay guard; context reads stay pure.
    if (this.deps.temporalEmotion) {
      await this.deps.temporalEmotion.advance(input.userId as UserId, requestId);
      personaData=await this.deps.contextData.loadPersonaData(input.userId as UserId);
    }

    // Step 3 — Bounded deterministic situation hints (MVP-005A).
    const situation = classifySituation(input.text);
    (trace as { situation?: unknown }).situation = situation;
    executedSteps.push("situation-understanding");

    // Step 4 — Context Assembly (REAL in MVP-002B; C4 live in 002D;
    // C6 live in 002G). PersonaData was loaded in Step 2 (reused here).
    // History → Memory Retrieval (read-only) → Persona Runtime → C0–C7 → budget.
    // MVP-002G: load conversation history first (feeds C6 + retrieval).
    const contextStarted=Date.now();
    const turnTime=new Date();
    const conversationHistory = conversationEvents
      ? await conversationEvents.loadHistory({
          userId: input.userId as never,
          yaoyaoId: yaoyaoId as never,
          limit: 20,
          excludeRequestId: requestId,
        })
      : [];
    const experience=experienceForTurn(personaData.experience,input.text,conversationHistory,turnTime);
    const experienceGuidance=renderCompanionExperience(experience,input.text);
    const recentConversationTexts = conversationHistory.map(
      (t) => `${t.role === "user" ? "User" : "YaoYao"}: ${t.text}`,
    );
    // MVP-002D: retrieve relevant memories. The yaoyaoId is server-resolved
    // from PersonaData (§VIII) — never trusted from client input.
    const memoryRetrieval = this.deps.memoryRetrieval ?? new EmptyMemoryRetrieval();
    const style=conversationStyle(input.text);
    const retrievedMemoryContext = await memoryRetrieval.retrieve({
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
      recentConversation: style.topicShift?[]:recentConversationTexts.slice(-6),
      limit: 50,
      traceId: input.traceId,
    });
    const memoryContext=projectTurnMemories(retrievedMemoryContext,input.text,recentConversationTexts);
    const varietyGuidance=renderTurnVariety(input.text,recentConversationTexts.slice(-6),'',situation.intent);
    const assembled = this.assembler.assemble({
      data: personaData,
      additionalOverheadTokens:(experienceGuidance?estimateTokens(experienceGuidance):0)+(varietyGuidance?estimateTokens(varietyGuidance):0),
      inputText: input.text,
      memoryContext,
      conversationHistory:focusDisclosureHistory(input.text,conversationHistory),
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
    measurements.contextMs=Date.now()-contextStarted;
    measurements.historyIncluded=assembled.history.included;measurements.historyDropped=assembled.history.dropped;measurements.historyNewestTruncated=assembled.history.newestTruncated;measurements.estimatedContextTokens=assembled.promptContext.estimatedInputTokens;
    executedSteps.push("context-assembly");

    // Step 5 — Decision (REAL in MVP-002F).
    // Decision Engine: deterministic baseline → validation → final decision.
    // Decision ≠ Response: this is behavioral guidance, not authority.
    const decisionStart = Date.now();
    const decisionEngine = new DecisionEngine();
    const currentEmotionForDecision = Object.fromEntries(
      EMOTION_DIMENSIONS.map((d) => [d, personaData.state.emotion.get(d)]),
    ) as Record<EmotionDimension, number>;
    const { decision, source: decisionSource } = decisionEngine.decide({
      userId: String(input.userId),
      yaoyaoId: String(personaData.yaoyao.yaoyaoId),
      currentInput: input.text,
      situation: {
        intent: situation.intent,
        urgency: situation.urgency,
        taskNature: situation.taskNature,
      },
      emotion: currentEmotionForDecision,
      personaTone: "warm",
      recentConversation: recentConversationTexts.slice(-6),
      traceId: input.traceId,
    });
    (trace as { decision?: unknown }).decision = {
      ...decision,
      source: decisionSource,
      latencyMs: Date.now() - decisionStart,
    };
    executedSteps.push("decision");

    // Step 6 — LLM Generation: router selects the provider for this turn
    // (task=conversation → L2), then the resilient invoker handles
    // retry/fallback. The runtime never touches a vendor SDK.
    // The Decision is rendered as behavioral guidance into the system prompt.
    const selected = this.deps.router.select({
      task: "conversation",
      fallbackAllowed: true,
    });
    const invoker = new ResilientLLMInvoker(
      selected.provider,
      this.deps.router.fallbackProvider(),
    );
    const modelDeadline=Date.now()+(this.deps.modelBudgetMs??45000);
    const llmRequest: LLMRequest = {
      userId: input.userId as UserId,
      yaoyaoId: assembled.yaoyaoId as never,
      systemContext: [
        assembled.promptContext.systemPrompt,
        renderDecisionGuidance(decision),
        renderConversationContinuity(input.text,recentConversationTexts.slice(-6),{now:turnTime,turns:conversationHistory}),
        experienceGuidance,
        varietyGuidance,
      ].join("\n\n"),
      conversationContext: assembled.promptContext.contextText,
      userInputInContext:true,
      maxOutputTokens:this.deps.maxOutputTokens??2000,
      userInput: input.text,
      decision,
      outputSchemaName: "llm-output-contract-v1",
      timeoutMs: Math.min(30000,Math.max(1,modelDeadline-Date.now())),
      metadata: {
        runtimeVersion: "mvp-008",
        contextVersion: "c0-c7-v1",
        requestId: input.traceId,
      },
    };
    const { proposal, telemetry } = await invoker.invoke(llmRequest);
    recordModel(telemetry);
    (trace as { llm?: unknown }).llm = {
      providerId: telemetry.providerId,
      modelId: telemetry.modelId,
      latencyMs: telemetry.latencyMs,
      retryCount: telemetry.retryCount,
      fallbackUsed: telemetry.fallbackUsed,
      routingReason: selected.reason,
    };
    executedSteps.push("llm-generation");

    // Step 7 — Response Validation (FULL in MVP-002F).
    // Pipeline: schema → identity → relationship → behavior → continuity
    // → safety → core-proposal. On failure: one repair retry, then fallback.
    // Validation NEVER mutates Core State — it is a gate, not an authority.
    const validationStart = Date.now();
    let validationOutcome = validateResponse({
      proposal,
      decision,
      userInput: input.text,
      recentConversation: recentConversationTexts.slice(-6),
      memoryEvidence:selectedMemoryEvidence(memoryContext),
      experience,
      timing:{now:turnTime,turns:conversationHistory},
    });
    const failures=validationOutcome.passed?[]:[validationFailureSummary(validationOutcome)];
    let repairAttempts = 0;
    let repairProviderFallback=false;
    let fallbackUsed = false;
    const MAX_REPAIR_ATTEMPTS = 1;

    while (!validationOutcome.passed && repairAttempts < MAX_REPAIR_ATTEMPTS && Date.now()<modelDeadline) {
      repairAttempts += 1;
      const repairRequest: LLMRequest = {
        ...llmRequest,
        timeoutMs:Math.min(30000,Math.max(1,modelDeadline-Date.now())),
        systemContext: [
          llmRequest.systemContext,
          buildRepairInstruction(
            validationOutcome.stage,
            validationOutcome.reason,
          ),
        ].join("\n\n"),
        metadata: {
          ...llmRequest.metadata,
          requestId: `${input.traceId}-repair-${repairAttempts}`,
        },
      };
      const repaired = await invoker.invoke(repairRequest);
      recordModel(repaired.telemetry);
      repairProviderFallback ||= repaired.telemetry.fallbackUsed;
      validationOutcome = validateResponse({
        proposal: repaired.proposal,
        decision,
        userInput: input.text,
        recentConversation: recentConversationTexts.slice(-6),
        memoryEvidence:selectedMemoryEvidence(memoryContext),
      experience,
        timing:{now:turnTime,turns:conversationHistory},
      });
      if(!validationOutcome.passed)failures.push(validationFailureSummary(validationOutcome));
    }

    let finalResponse: string;
    if (validationOutcome.passed) {
      finalResponse = validationOutcome.response;
    } else {
      // Fallback: safe YaoYao-style response. Never exposes internals.
      fallbackUsed = true;
      finalResponse = buildFallbackResponse({
        userInput: input.text,
        decision,
        experience,
        recentConversation:[...selectedMemoryEvidence(memoryContext),...recentConversationTexts],
      });
    }
    (trace as { validation?: unknown }).validation = {
      stagesPassed: validationOutcome.passed
        ? ["schema", "identity", "relationship", "behavior", "continuity", "safety", "core-proposal"]
        : [],
      validationPassed: validationOutcome.passed,
      validationFailureReason: validationOutcome.passed
        ? undefined
        : `${validationOutcome.stage}: ${validationOutcome.reason}`,
      validationLatencyMs: Date.now() - validationStart,
      repairAttempts,
      failures,
      providerFallbackUsed:telemetry.fallbackUsed||repairProviderFallback,
      fallbackUsed,
      finalResponseAccepted: true,
      ...(groundedLifeReply(experience,input.text)?{groundedRecordReply:true}:{}),
    };
    executedSteps.push("behavior-validation");

    // Step 8 — State / Memory Processing (REAL in MVP-002E).
    // I-016 chain: interpret → validate → domain transition → CAS →
    // STATE_CHANGED → commit. The interpreter only proposes; the domain
    // disposes. Response-critical: persisted before response delivery.
    const writebackTrace: Record<string, unknown> = {
      stateChanged: false,
      eventsCommitted: 0,
    };
    if (this.deps.emotionInterpreter && this.deps.emotionWriter && Date.now()<modelDeadline) {
      const emotionStart = Date.now();
      let interpreted=false;
      try {
        // Current emotion state (Emotion State layer) from Step 4.
        const currentEmotion = Object.fromEntries(
          EMOTION_DIMENSIONS.map((d) => [d, personaData.state.emotion.get(d)]),
        ) as Record<EmotionDimension, number>;

        // 1. Interpret (proposal only — no persistence path).
        const { proposal, telemetry } = await this.deps.emotionInterpreter.interpret({
          userId: input.userId as UserId,
          yaoyaoId: personaData.yaoyao.yaoyaoId as YaoYaoId,
          timeoutMs:Math.min(20000,Math.max(1,modelDeadline-Date.now())),
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
          currentEmotion,
          recentConversation: [],
          relevantMemories: memoryContext.memories.map((m) => m.summary),
          traceId: input.traceId,
        });
        recordModel(telemetry);interpreted=true;
        measurements.emotionMs=Date.now()-emotionStart;
        writebackTrace["emotionInterpreterLatencyMs"] = Date.now() - emotionStart;
        writebackTrace["interpreterProvider"] = telemetry.providerId;
        writebackTrace["interpreterModel"] = telemetry.modelId;
        writebackTrace["interpreterFallbackUsed"] = telemetry.fallbackUsed;

        // 2. Validate (the gate).
        const validation = validateEmotionProposal(proposal);
        if (!validation.accepted) {
          writebackTrace["proposalAccepted"] = false;
          writebackTrace["validationFailureReason"] = validation.reason;
        } else {
          writebackTrace["proposalAccepted"] = true;
          writebackTrace["proposalRejected"] = false;
          if (validation.clamped.length > 0) {
            writebackTrace["clampedDimensions"] = [...validation.clamped];
          }

          // 3. Transactional write-back (domain transition → CAS → event).
          const result = await this.deps.emotionWriter.writeback({
            userId: input.userId as UserId,
            yaoyaoId: personaData.yaoyao.yaoyaoId as YaoYaoId,
            deltas: validation.deltas,
            expectedVersion: personaData.state.stateVersion,
            traceId: input.traceId,
          });

          if (result.outcome === "applied") {
            writebackTrace["stateChanged"] = true;
            writebackTrace["eventsCommitted"] = 1;
            writebackTrace["stateTransitionSuccess"] = true;
            writebackTrace["newStateVersion"] = result.newVersion;
            writebackTrace["eventId"] = result.eventId;
          } else if (result.outcome === "conflict") {
            writebackTrace["stateTransitionSuccess"] = false;
            writebackTrace["casConflict"] = true;
            writebackTrace["casExpected"] = result.expected;
            writebackTrace["casCurrent"] = result.current;
          } else {
            writebackTrace["stateTransitionSuccess"] = true;
            writebackTrace["note"] = "no-change: empty deltas";
          }
        }
      } catch (err) {
        // Emotion processing must never break the conversation turn.
        // Record the failure; the response still delivers.
        if(!interpreted)measurements.failedInvocations++;measurements.emotionMs=Date.now()-emotionStart;
        writebackTrace["stateTransitionSuccess"] = false;
        writebackTrace["error"] =
          err instanceof Error ? err.message : String(err);
      }
    } else if(this.deps.emotionInterpreter&&this.deps.emotionWriter){
      measurements.emotionBudgetSkipped=true;
      writebackTrace["note"]="skipped: this turn model time budget exhausted";
    } else {
      writebackTrace["note"] =
        "skipped: emotion interpreter/writer not wired (no-op in unit tests)";
    }
    (trace as { writeback?: unknown }).writeback = writebackTrace;
    executedSteps.push("state-memory-processing");

    // Step 9 — Response Delivery: the ONLY legal release site.
    // finalResponse is either the validated LLM output or the safe fallback.
    let response = finalResponse;
    executedSteps.push("response-delivery");

    // Step 10 — Event Recording (REAL in MVP-002G).
    // Tx2: persist ASSISTANT_MESSAGE with the FINAL delivered response
    // (G-RED-001). Only the validated/fallback response is stored —
    // never raw/rejected/repair-predecessor output.
    //
    // Crash recovery (MVP-002G v0.2): Tx2 failure is FATAL to the turn.
    // We do NOT catch and deliver anyway — that would create a
    // "delivered but not persisted" state that can never be reconciled
    // (the user saw a response with no event log entry; a retry would
    // generate a different response). Instead the turn throws, the
    // client gets a 500, and retries with the same requestId:
    //   - findCompletedTurn → null (no ASSISTANT_MESSAGE persisted)
    //   - persistUserMessage → idempotent (returns the existing
    //     USER_MESSAGE by correlationId=requestId, no duplicate)
    //   - pipeline re-runs, Tx2 is retried
    // Crash between Tx2 commit and HTTP flush is already safe: the
    // retry's findCompletedTurn finds the persisted ASSISTANT_MESSAGE
    // and returns the stored response without re-running the LLM (G25).
    if (conversationEvents) {
      const persisted = await conversationEvents.persistAssistantMessage({
        userId: input.userId as never,
        yaoyaoId: yaoyaoId as never,
        sessionId: input.sessionId ?? null,
        text: response,
        requestId,
        traceId: input.traceId,
      });
      response=persisted.response??response;
      (trace as { eventRecording?: unknown }).eventRecording = {
        status: "persisted",
        assistantMessageEventId: persisted.eventId,
        requestId,
      };
    } else {
      (trace as { eventRecording?: unknown }).eventRecording = {
        status: "skipped-no-conversation-events",
      };
    }
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
