/**
 * MockLLMProvider — MVP-002C (updated for the provider-neutral request shape).
 *
 * Implements the LLMProvider port with a fixed, structured LLMProposal.
 * Used for unit tests, runtime tests, validation tests, replay tests, and
 * CI. MUST NOT be removed when real providers are wired — it remains the
 * deterministic test double.
 *
 * This is NOT a production provider. Production adapters live in
 * @yaoyao/infrastructure/llm.
 */
import {
  asProposal,
  type LLMProposal,
  type LLMProvider,
  type LLMRequest,
  type ProviderCapabilities,
} from "@yaoyao/application";

export class MockLLMProvider implements LLMProvider {
  readonly providerId = "mock";
  readonly modelId = "mock-echo-002A";
  readonly capabilities: ProviderCapabilities = {
    supportsStructuredOutput: true,
    maxContextTokens: 8000,
    costTier: 1,
  };

  async generate(request: LLMRequest): Promise<LLMProposal> {
    return {
      response: asProposal(
        `（MVP-002C 回音）收到：「${request.userInput}」—— Router → Mock Provider，结构化 Proposal 返回正常。`,
      ),
      emotion_signal: asProposal({}),
      memory_candidates: asProposal([]),
      relationship_signal: asProposal({}),
      behavior: asProposal({}),
    };
  }
}
