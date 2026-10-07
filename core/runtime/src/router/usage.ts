/**
 * Provider usage / cost telemetry — MVP-002C (§XV).
 *
 * Telemetry only, NOT billing. Records per-call token usage and a cost
 * estimate from a configurable per-model price table. The estimates exist
 * for operations visibility (which provider/model is burning budget),
 * not for charging anyone.
 *
 * Prices are USD per 1M tokens, configurable. Defaults below are
 * placeholders — real prices come from config/env in production wiring.
 */
import type { ProviderUsage } from "@yaoyao/application";

export interface ModelPricing {
  /** USD per 1M input tokens. */
  readonly inputPer1M: number;
  /** USD per 1M output tokens. */
  readonly outputPer1M: number;
}

export type PricingTable = Readonly<Record<string, ModelPricing>>;

export const DEFAULT_PRICING: PricingTable = {
  // providerId/modelId → pricing. Overridden by config in production.
  "mock/mock-echo-002A": { inputPer1M: 0, outputPer1M: 0 },
  "deepseek/deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.1 },
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

export function estimateUsage(input: {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  latencyMs: number;
  pricing?: PricingTable;
}): ProviderUsage {
  const pricing = input.pricing ?? DEFAULT_PRICING;
  const key = `${input.providerId}/${input.modelId}`;
  const price = pricing[key] ?? { inputPer1M: 0, outputPer1M: 0 };
  const estimatedCostUsd =
    (input.inputTokens / 1_000_000) * price.inputPer1M +
    (input.outputTokens / 1_000_000) * price.outputPer1M;
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedInputTokens: input.cachedInputTokens,
    latencyMs: input.latencyMs,
    estimatedCostUsd,
  };
}
