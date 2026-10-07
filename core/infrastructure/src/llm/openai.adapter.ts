/**
 * OpenAI provider adapter — MVP-002C.
 *
 * Second candidate provider (fallback / benchmark). Not a frozen primary —
 * see 002C authorization §X. Uses the shared OpenAI-compatible base with
 * OpenAI's endpoint.
 */
import { OpenAICompatibleAdapter } from "./base.adapter.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIAdapterConfig {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly defaultTimeoutMs?: number;
}

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor(config: OpenAIAdapterConfig) {
    super({
      providerId: "openai",
      modelId: config.modelId ?? "gpt-4o-mini",
      baseURL: OPENAI_BASE_URL,
      apiKey: config.apiKey,
      capabilities: {
        supportsStructuredOutput: true,
        maxContextTokens: 128000,
        costTier: 2,
      },
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
    });
  }
}
