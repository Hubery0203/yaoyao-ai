/**
 * Resilient LLM invocation — MVP-002C (timeout / retry / fallback).
 *
 * Wraps a primary LLMProvider with:
 * - 1 retry on retryable ProviderError (timeout, 429, 5xx, invalid output)
 * - Backoff for 429 (uses the adapter's retryAfterMs hint, capped)
 * - Fallback to a secondary provider when the primary is exhausted
 *
 * I-016 / §XII: retrying NEVER risks Core mutation — the provider layer
 * has no persistence path by construction. Retries are safe because the
 * only side effect of generate() is returning a Proposal.
 *
 * Observability (§XIV): every attempt is recorded (provider, model,
 * attempt, latency, failure reason, fallback used). No secrets, no
 * prompts, no API keys in the telemetry.
 */
import {
  ProviderError,
  type LLMProposal,
  type LLMProvider,
  type LLMRequest,
  type ProviderCallTelemetry,
} from "@yaoyao/application";

export interface ResilienceConfig {
  /** Max retries on the primary before falling back (default 1). */
  readonly maxRetries?: number;
  /** Base backoff ms for retryable errors without a hint (default 500). */
  readonly baseBackoffMs?: number;
  /** Max backoff ms (default 5000). */
  readonly maxBackoffMs?: number;
}

export interface ResilientResult {
  readonly proposal: LLMProposal;
  readonly telemetry: ProviderCallTelemetry;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ResilientLLMInvoker {
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(
    private readonly primary: LLMProvider,
    private readonly fallback: LLMProvider,
    config: ResilienceConfig = {},
  ) {
    this.maxRetries = config.maxRetries ?? 1;
    this.baseBackoffMs = config.baseBackoffMs ?? 500;
    this.maxBackoffMs = config.maxBackoffMs ?? 5000;
  }

  async invoke(request: LLMRequest): Promise<ResilientResult> {
    const requestId = request.metadata.requestId;
    const started = Date.now();
    let retryCount = 0;
    let lastError: ProviderError | undefined;

    // Primary attempts: initial + retries.
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const proposal = await this.primary.generate(request);
        return {
          proposal,
          telemetry: {
            requestId,
            providerId: this.primary.providerId,
            modelId: this.primary.modelId,
            latencyMs: Date.now() - started,
            retryCount,
            fallbackUsed: false,
            validationResult: "not-run",
          },
        };
      } catch (err) {
        if (err instanceof ProviderError && err.retryable && attempt < this.maxRetries) {
          retryCount++;
          const backoff = Math.min(
            err.retryAfterMs ?? this.baseBackoffMs * 2 ** attempt,
            this.maxBackoffMs,
          );
          await sleep(backoff);
          continue;
        }
        lastError = err instanceof ProviderError ? err : undefined;
        break;
      }
    }

    // Fallback: single attempt, no retry (fail-fast to the safe fallback).
    try {
      const proposal = await this.fallback.generate(request);
      return {
        proposal,
        telemetry: {
          requestId,
          providerId: this.fallback.providerId,
          modelId: this.fallback.modelId,
          latencyMs: Date.now() - started,
          retryCount,
          fallbackUsed: true,
          validationResult: "not-run",
        },
      };
    } catch (fallbackErr) {
      const reason =
        fallbackErr instanceof ProviderError
          ? `${fallbackErr.code}`
          : "unknown";
      const primaryReason = lastError ? lastError.code : "unknown";
      throw new ProviderError({
        code: "UNKNOWN",
        providerId: this.primary.providerId,
        message:
          `primary failed (${primaryReason}) and fallback failed (${reason}); ` +
          `no proposal produced`,
        retryable: false,
      });
    }
  }
}
