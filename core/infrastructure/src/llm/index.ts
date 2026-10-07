/**
 * @yaoyao/infrastructure/llm — provider adapters (MVP-002C).
 *
 * Only this module (and apps/* wiring) may touch vendor SDKs or API keys.
 * The runtime never imports from here (boundary-enforced).
 */
export { OpenAICompatibleAdapter, type AdapterConfig } from "./base.adapter.js";
export { DeepSeekAdapter, type DeepSeekAdapterConfig } from "./deepseek.adapter.js";
export { OpenAIAdapter, type OpenAIAdapterConfig } from "./openai.adapter.js";
export {
  LLMOutputSchema,
  LLM_OUTPUT_JSON_SCHEMA,
  STRUCTURED_OUTPUT_INSTRUCTION,
  type LLMOutputShape,
} from "./schema.js";
export {
  EmotionProposalSchema,
  type EmotionProposalShape,
} from "./emotion-schema.js";
