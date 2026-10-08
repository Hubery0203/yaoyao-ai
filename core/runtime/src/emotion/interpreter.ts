/**
 * RouterEmotionInterpreter — MVP-002E.
 *
 * Implements the EmotionInterpreter port via AI Router → LLMProvider.
 *
 * Chain (§17):
 *   EmotionEngine → EmotionInterpreter → AI Router → LLMProvider → Provider Adapter
 *
 * - Router selects the L1 tier for interpretation (task="structured";
 *   §18: no model is frozen — DeepSeek today, OpenAI or another tomorrow).
 * - The resilient invoker handles retry/fallback (002C).
 * - The request uses outputSchemaName "emotion-proposal-v1"; the
 *   infrastructure adapter validates the raw output against the
 *   interpreter schema and places the parsed proposal in `emotion_signal`.
 * - This class extracts `emotion_signal` and returns it as an
 *   EmotionProposal. It NEVER writes state — interpretation only.
 *
 * Urgency (§12): when situation.urgency is high, the prompt instructs the
 * model to temper negative-emotion amplification (user need > YaoYao's
 * emotional expression). The CoreState is still updated per the validated
 * proposal — urgency modulates the proposal, never bypasses validation.
 */
import {
  EMOTION_PROPOSAL_SCHEMA_NAME,
  unwrapProposal,
  type EmotionInterpreter,
  type EmotionInterpretationInput,
  type EmotionInterpretationResult,
  type EmotionProposal,
} from "@yaoyao/application";
import { EMOTION_DIMENSIONS, type EmotionDimension } from "@yaoyao/domain";
import { AIRouter } from "../router/router.js";
import { ResilientLLMInvoker } from "../router/resilient.js";

const INTERPRETER_INSTRUCTION = `You are YaoYao's emotion interpreter. Given the current emotional state, the user's message, the situation, and relevant memories, propose how YaoYao's emotions should shift.

Rules:
- Output ONLY a JSON object with this exact shape:
  {
    "primary": "<one of: ${EMOTION_DIMENSIONS.join(", ")}>",
    "secondary": ["<other co-occurring dimensions>"],
    "intensity": <0-1 overall intensity>,
    "signals": { "<dimension>": <delta in -1..1>, ... },
    "confidence": <0-1>,
    "cause": "<short machine-readable cause tag, optional>"
  }
- "signals" are DELTAS to the current values (e.g. hurt: 0.15 means hurt rises by 0.15), NOT absolute targets. Keep each |delta| <= 0.30.
- Multiple emotions may coexist (e.g. affection 0.85 with hurt 0.62). Never collapse to a single emotion.
- NEVER propose changes to identity, relationship type/status, or termination. Emotions never cause breakup.
- jealousy must never imply control, coercion, surveillance, or punishment of the user.
- anger may express disagreement or boundaries, never insult, abuse, or retaliation.
- If the user's situation is urgent or they need support, temper negative-emotion amplification: the user's need comes first. Do NOT zero out existing emotions; just avoid amplifying hurt/anger.
- Be conservative: small, believable shifts. Emotion does not instantly reset.`;

export class RouterEmotionInterpreter implements EmotionInterpreter {
  constructor(private readonly router: AIRouter) {}

  async interpret(
    input: EmotionInterpretationInput,
  ): Promise<EmotionInterpretationResult> {
    const selected = this.router.select({
      task: "structured",
      fallbackAllowed: true,
    });
    const invoker = new ResilientLLMInvoker(
      selected.provider,
      this.router.fallbackProvider(),
      { maxRetries: 1 },
    );

    const emotionLines = EMOTION_DIMENSIONS.map(
      (d) => `${d}: ${input.currentEmotion[d].toFixed(2)}`,
    ).join(", ");

    const memoryLines =
      input.relevantMemories.length === 0
        ? "none"
        : input.relevantMemories.map((m) => `- ${m}`).join("\n");

    const urgencyNote =
      input.situation.urgency === "high" || input.situation.urgency === "urgent"
        ? "\nURGENT: the user needs support right now. Temper negative-emotion amplification."
        : "";

    const { proposal, telemetry } = await invoker.invoke({
      userId: input.userId,
      yaoyaoId: input.yaoyaoId,
      systemContext: INTERPRETER_INSTRUCTION,
      conversationContext: [
        `Current emotion state: { ${emotionLines} }`,
        `Relationship: type=${input.relationshipContext.type}, status=${input.relationshipContext.status}`,
        `Situation: intent=${input.situation.intent}, urgency=${input.situation.urgency}, task=${input.situation.taskNature}${urgencyNote}`,
        `Relevant memories:\n${memoryLines}`,
        `Recent conversation: ${input.recentConversation.slice(-3).join(" | ") || "none"}`,
      ].join("\n\n"),
      userInput: input.currentInput,
      decision: {
        primaryIntent: "answer",
        secondaryIntents: [],
        conversationMode: "normal",
        emotionalExpression: "none",
        initiative: "none",
        followUp: "none",
        topicContinuity: "continue",
        selfExpression: "none",
      },
      outputSchemaName: EMOTION_PROPOSAL_SCHEMA_NAME,
      timeoutMs: 20_000,
      metadata: {
        runtimeVersion: "mvp-002e",
        contextVersion: "emotion-v1",
        requestId: input.traceId,
      },
    });

    const raw = unwrapProposal(proposal.emotion_signal) as Record<string, unknown>;

    // Normalize to the EmotionProposal contract. Full validation happens
    // in validateEmotionProposal (the gate); here we only shape the data.
    const signals: Partial<Record<EmotionDimension, number>> = {};
    const rawSignals = (raw["signals"] ?? {}) as Record<string, unknown>;
    for (const dim of EMOTION_DIMENSIONS) {
      const v = rawSignals[dim];
      if (typeof v === "number") signals[dim] = v;
    }

    const resultProposal: EmotionProposal = {
      primary: (EMOTION_DIMENSIONS as readonly string[]).includes(
        raw["primary"] as string,
      )
        ? (raw["primary"] as EmotionDimension)
        : "calm",
      secondary: Array.isArray(raw["secondary"])
        ? (raw["secondary"] as string[]).filter((d) =>
            (EMOTION_DIMENSIONS as readonly string[]).includes(d),
          ) as EmotionDimension[]
        : [],
      intensity:
        typeof raw["intensity"] === "number" ? raw["intensity"] : 0,
      signals,
      confidence:
        typeof raw["confidence"] === "number" ? raw["confidence"] : 0,
      cause: typeof raw["cause"] === "string" ? raw["cause"] : undefined,
    };

    return {
      proposal: resultProposal,
      telemetry: {
        providerId: telemetry.providerId,
        modelId: telemetry.modelId,
        latencyMs: telemetry.latencyMs,
        retryCount: telemetry.retryCount,
        fallbackUsed: telemetry.fallbackUsed,
      },
    };
  }
}
