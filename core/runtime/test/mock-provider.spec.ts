/**
 * MockLLMProvider tests — MVP-002A.
 *
 * - Implements the LLMProvider port.
 * - Returns a fixed, structured LLMProposal (all fields are Proposals).
 * - No network, no SDK, no side effects.
 */
import { describe, expect, it } from "vitest";
import { MockLLMProvider } from "@yaoyao/runtime";

describe("MockLLMProvider", () => {
  it("identifies as the mock provider", () => {
    const mock = new MockLLMProvider();
    expect(mock.providerId).toBe("mock");
    expect(mock.modelId).toBe("mock-echo-002A");
  });

  it("returns a structured proposal with all 5 contract fields as Proposals", async () => {
    const mock = new MockLLMProvider();
    const proposal = await mock.generate({
      userId: "u" as never,
      yaoyaoId: "y" as never,
      context: {
        inputText: "hello",
        decision: { primaryIntent: "answer", conversationMode: "normal" },
      },
      outputSchemaName: "llm-output-contract-v1",
      timeoutMs: 1000,
      traceId: "t",
    });
    for (const field of [
      "response",
      "emotion_signal",
      "memory_candidates",
      "relationship_signal",
      "behavior",
    ] as const) {
      expect(proposal[field]).toMatchObject({ __proposal: true });
    }
    expect(proposal.response.value).toContain("hello");
  });
});
