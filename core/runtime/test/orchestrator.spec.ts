/**
 * ConversationOrchestrator unit tests — MVP-002A.
 *
 * - The 10 canonical steps execute in the frozen order.
 * - The trace records each step.
 * - The Mock provider is invoked via the port (no SDK).
 * - The response comes from the validated proposal.
 */
import { describe, expect, it } from "vitest";
import { EmotionVector } from "@yaoyao/domain";
import { MockLLMProvider } from "@yaoyao/runtime";
import {
  CANONICAL_STEP_ORDER,
  ConversationOrchestrator,
} from "@yaoyao/runtime";


/** Minimal fake ContextDataPort for skeleton tests (no DB). */
function fakeContextData(overrides: Partial<{
  yaoyaoId: string; userId: string;
  relationshipType: string; relationshipStatus: string; terminationAllowed: boolean;
}> = {}) {
  return {
    loadPersonaData: async (userId: string) => ({
      yaoyao: { yaoyaoId: overrides.yaoyaoId ?? "yaoyao-1", userId: overrides.userId ?? userId },
      relationship: {
        type: overrides.relationshipType ?? "deep_partner",
        status: overrides.relationshipStatus ?? "active",
        terminationAllowed: overrides.terminationAllowed ?? false,
        metrics: { intimacy: 0.8 },
      },
      state: {
        emotion: EmotionVector.initial(),
        energy: 0.7,
        socialState: "calm",
        relationshipState: "harmonious",
        attention: "present",
        stateVersion: 1,
      },
      recentEvents: [],
    }),
  };
}

const EXPECTED_ORDER = [
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
] as const;

describe("ConversationOrchestrator (MVP-002A skeleton)", () => {
  it("exposes the frozen 10-step canonical order", () => {
    expect(CANONICAL_STEP_ORDER).toEqual([...EXPECTED_ORDER]);
    expect(CANONICAL_STEP_ORDER).toHaveLength(10);
  });

  it("runs the full echo path: input → mock provider → response", async () => {
    const orchestrator = new ConversationOrchestrator({
      llm: new MockLLMProvider(),
      contextData: fakeContextData() as never,
    });
    const { response, trace } = await orchestrator.converse({
      userId: "user-123",
      text: "你好呀",
      traceId: "trace-1",
    });

    expect(response).toContain("你好呀");
    expect(response).toContain("MVP-002A");
    expect(trace.traceId).toBe("trace-1");
    expect(trace.userId).toBe("user-123");
  });

  it("records the executed steps in canonical order in the trace", async () => {
    const orchestrator = new ConversationOrchestrator({
      llm: new MockLLMProvider(),
      contextData: fakeContextData() as never,
    });
    const { trace } = await orchestrator.converse({
      userId: "user-123",
      text: "hi",
      traceId: "trace-2",
    });
    const steps = (trace as unknown as { steps: string[] }).steps;
    expect(steps).toEqual([...EXPECTED_ORDER]);
  });

  it("creates a pending (in-memory) event at step 2 — nothing persisted", async () => {
    const orchestrator = new ConversationOrchestrator({
      llm: new MockLLMProvider(),
      contextData: fakeContextData() as never,
    });
    const { trace } = await orchestrator.converse({
      userId: "user-123",
      text: "hi",
      traceId: "trace-3",
    });
    expect(trace.eventCreation?.status).toBe("pending");
    expect(trace.eventCreation?.correlationId).toBeTruthy();
    // Skeleton performs zero writes (I-016).
    expect(trace.writeback?.eventsCommitted).toBe(0);
    expect(trace.writeback?.stateChanged).toBe(false);
  });

  it("records the mock provider identity in the trace (no vendor SDK)", async () => {
    const orchestrator = new ConversationOrchestrator({
      llm: new MockLLMProvider(),
      contextData: fakeContextData() as never,
    });
    const { trace } = await orchestrator.converse({
      userId: "user-123",
      text: "hi",
      traceId: "trace-4",
    });
    expect(trace.llm?.providerId).toBe("mock");
    expect(trace.llm?.fallbackUsed).toBe(false);
  });
});
