/**
 * MockLLMProvider — MVP-002A echo-path test double.
 *
 * Implements the LLMProvider port with a fixed, structured LLMProposal.
 * Used to prove the full pipeline (HTTP → Runtime → Provider → Response)
 * without any real model, vendor SDK, or network call.
 *
 * This is NOT a production provider. Production adapters
 * (DeepSeek/OpenAI) arrive in MVP-002C under @yaoyao/infrastructure/llm.
 * The mock lives in @yaoyao/runtime/testing so the boundary
 * "runtime never imports infrastructure" stays intact.
 */
import {
  asProposal,
  type LLMProposal,
  type LLMProvider,
  type LLMRequest,
} from "@yaoyao/application";

export class MockLLMProvider implements LLMProvider {
  readonly providerId = "mock";
  readonly modelId = "mock-echo-002A";

  async generate(request: LLMRequest): Promise<LLMProposal> {
    return {
      response: asProposal(
        `（MVP-002A 回音）收到：「${request.context.inputText}」—— Runtime 骨架跑通，Mock Provider 返回结构化 Proposal。`,
      ),
      emotion_signal: asProposal({}),
      memory_candidates: asProposal([]),
      relationship_signal: asProposal({}),
      behavior: asProposal({}),
    };
  }
}
