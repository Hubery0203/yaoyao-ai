/**
 * DeepSeek provider adapter — MVP-002C.
 *
 * DeepSeek exposes an OpenAI-compatible API; this adapter configures the
 * shared base with DeepSeek's endpoint and model. DeepSeek is a CANDIDATE
 * provider (not a frozen primary) — see 002C authorization §X.
 */
import { OpenAICompatibleAdapter } from "./base.adapter.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export interface DeepSeekAdapterConfig {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly defaultTimeoutMs?: number;
}

export class DeepSeekAdapter extends OpenAICompatibleAdapter {
  constructor(config: DeepSeekAdapterConfig) {
    super({
      providerId: "deepseek",
      modelId: config.modelId ?? "deepseek-chat",
      baseURL: DEEPSEEK_BASE_URL,
      apiKey: config.apiKey,
      capabilities: {
        supportsStructuredOutput: true,
        maxContextTokens: 64000,
        costTier: 1,
      },
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30_000,
    });
  }
}
