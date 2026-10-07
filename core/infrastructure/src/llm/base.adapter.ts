/**
 * OpenAI-compatible provider adapter base — MVP-002C.
 *
 * Both OpenAI and DeepSeek expose an OpenAI-compatible chat-completions
 * API, so a single base class drives both via the `openai` SDK with a
 * configurable baseURL. Provider-specific subclasses supply the
 * providerId, modelId, baseURL, and capabilities.
 *
 * Security (002C §V):
 * - The API key is held ONLY in this instance (constructor-injected from
 *   server-side env via apps/api wiring). It is never logged, never
 *   included in errors, traces, or telemetry.
 * - Error messages are sanitized: provider code + safe detail only.
 *
 * Resilience (§XII): timeouts, 429 (with backoff hint), 5xx, and invalid
 * responses are mapped to typed ProviderError with retryable flags. The
 * retry/fallback policy lives in the resilient wrapper (@yaoyao/runtime);
 * the adapter only classifies.
 */
import {
  asProposal,
  ProviderError,
  type LLMProposal,
  type LLMProvider,
  type LLMRequest,
  type ProviderCapabilities,
} from "@yaoyao/application";
import OpenAI from "openai";
import { LLMOutputSchema, STRUCTURED_OUTPUT_INSTRUCTION } from "./schema.js";

export interface AdapterConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly baseURL: string;
  readonly apiKey: string;
  readonly capabilities: ProviderCapabilities;
  readonly defaultTimeoutMs: number;
}

export abstract class OpenAICompatibleAdapter implements LLMProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities;
  protected readonly client: OpenAI;
  protected readonly defaultTimeoutMs: number;

  constructor(config: AdapterConfig) {
    if (!config.apiKey) {
      throw new ProviderError({
        code: "AUTH_ERROR",
        providerId: config.providerId,
        message: "API key is missing (configure via environment)",
        retryable: false,
      });
    }
    this.providerId = config.providerId;
    this.modelId = config.modelId;
    this.capabilities = config.capabilities;
    this.defaultTimeoutMs = config.defaultTimeoutMs;
    // The SDK holds the key internally; we never expose it.
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async generate(request: LLMRequest): Promise<LLMProposal> {
    const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;
    const systemPrompt = [
      request.systemContext,
      STRUCTURED_OUTPUT_INSTRUCTION,
    ].join("\n\n");
    const userPrompt = [
      request.conversationContext,
      `[USER INPUT]\n${request.userInput}`,
    ].join("\n\n");

    let raw: string;
    const started = Date.now();
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          max_tokens: 2000,
          temperature: 0.7,
        },
        { timeout: timeoutMs },
      );
      raw = completion.choices[0]?.message?.content ?? "";
    } catch (err) {
      throw this.classifyError(err);
    }
    void started;

    if (!raw) {
      throw new ProviderError({
        code: "INVALID_RESPONSE",
        providerId: this.providerId,
        message: "empty completion content",
        retryable: true,
      });
    }

    return this.parseProposal(raw);
  }

  /**
   * Parse + schema-validate the raw JSON. Returns Proposal-wrapped fields.
   * Exported for unit tests (C02/C03 response mapping).
   */
  parseProposal(raw: string): LLMProposal {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new ProviderError({
        code: "INVALID_RESPONSE",
        providerId: this.providerId,
        message: "model output was not valid JSON",
        retryable: true,
      });
    }
    const parsed = LLMOutputSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError({
        code: "INVALID_RESPONSE",
        providerId: this.providerId,
        message: `model output failed schema validation: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        retryable: true,
      });
    }
    const out = parsed.data;
    return {
      response: asProposal(out.response),
      emotion_signal: asProposal(out.emotion_signal),
      memory_candidates: asProposal(out.memory_candidates),
      relationship_signal: asProposal(out.relationship_signal),
      behavior: asProposal(out.behavior),
    };
  }

  /**
   * Map SDK/HTTP errors to typed ProviderError. Sanitized: no keys,
   * no request bodies, no prompts in messages.
   */
  protected classifyError(err: unknown): ProviderError {
    const providerId = this.providerId;
    if (err instanceof OpenAI.APIConnectionTimeoutError || isTimeout(err)) {
      return new ProviderError({
        code: "TIMEOUT",
        providerId,
        message: "provider request timed out",
        retryable: true,
      });
    }
    if (err instanceof OpenAI.RateLimitError) {
      const retryAfter = parseRetryAfter(err);
      return new ProviderError({
        code: "RATE_LIMITED",
        providerId,
        message: "provider rate limit exceeded",
        retryable: true,
        retryAfterMs: retryAfter,
      });
    }
    if (err instanceof OpenAI.AuthenticationError) {
      return new ProviderError({
        code: "AUTH_ERROR",
        providerId,
        message: "provider authentication failed (check API key)",
        retryable: false,
      });
    }
    if (err instanceof OpenAI.InternalServerError) {
      return new ProviderError({
        code: "PROVIDER_5XX",
        providerId,
        message: "provider internal error",
        retryable: true,
      });
    }
    if (err instanceof OpenAI.APIError) {
      const retryable = err.status !== undefined && err.status >= 500;
      return new ProviderError({
        code: "UNKNOWN",
        providerId,
        message: `provider API error (status ${err.status ?? "unknown"})`,
        retryable,
      });
    }
    return new ProviderError({
      code: "UNKNOWN",
      providerId,
      message: "unexpected provider error",
      retryable: false,
    });
  }
}

function isTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|ETIMEDOUT|ECONNABORTED/i.test(msg);
}

function parseRetryAfter(err: InstanceType<typeof OpenAI.RateLimitError>): number | undefined {
  const headers = err.headers as unknown as { get?: (name: string) => string | null } | Record<string, string> | undefined;
  let header: string | null | undefined;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    header = (headers as { get: (name: string) => string | null }).get("retry-after");
  } else if (headers) {
    header = (headers as Record<string, string>)["retry-after"];
  }
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  return undefined;
}
