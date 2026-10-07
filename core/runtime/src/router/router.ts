/**
 * AI Model Router — MVP-002C.
 *
 * Deterministic routing policy (002C authorization §IX — no over-designed
 * agent router):
 *
 *   task=conversation → configured L2 (primary dialogue)
 *   task=structured  → configured L1 (cheap / structured)
 *   task=premium     → configured L3 (premium / complex)
 *   preferredProvider override (when specified and available)
 *
 * The router selects PROVIDERS, not models-in-stone: provider/model are
 * configuration, never hardcoded in the runtime. Model selection never
 * affects Identity, Relationship, or Core Authority (I-014).
 *
 * Lives in @yaoyao/runtime: it depends only on the LLMProvider port.
 * Concrete providers are injected by apps/* wiring.
 */
import type { LLMProvider } from "@yaoyao/application";

export type RoutingTask = "conversation" | "structured" | "premium";

export interface RoutingInput {
  readonly task: RoutingTask;
  readonly complexity?: "low" | "medium" | "high";
  readonly preferredProvider?: string;
  readonly fallbackAllowed: boolean;
}

export interface SelectedModel {
  readonly provider: LLMProvider;
  readonly tier: "L1" | "L2" | "L3";
  readonly reason: string;
}

export interface RouterConfig {
  readonly l1: LLMProvider;
  readonly l2: LLMProvider;
  readonly l3: LLMProvider;
  /** Provider used when the selected tier's provider fails (if fallbackAllowed). */
  readonly fallback: LLMProvider;
}

export class AIRouter {
  constructor(private readonly config: RouterConfig) {}

  select(input: RoutingInput): SelectedModel {
    // Preferred-provider override (when it names a configured provider).
    if (input.preferredProvider) {
      const override = this.findByProviderId(input.preferredProvider);
      if (override) {
        return {
          ...override,
          reason: `preferredProvider override: ${input.preferredProvider}`,
        };
      }
    }

    switch (input.task) {
      case "structured":
        return {
          provider: this.config.l1,
          tier: "L1",
          reason: "task=structured → L1 (cheap/structured)",
        };
      case "premium":
        return {
          provider: this.config.l3,
          tier: "L3",
          reason: "task=premium → L3 (premium/complex)",
        };
      case "conversation":
      default:
        return {
          provider: this.config.l2,
          tier: "L2",
          reason: "task=conversation → L2 (primary dialogue)",
        };
    }
  }

  /** The fallback provider for the resilient wrapper. */
  fallbackProvider(): LLMProvider {
    return this.config.fallback;
  }

  private findByProviderId(
    providerId: string,
  ): { provider: LLMProvider; tier: "L1" | "L2" | "L3" } | undefined {
    const tiers = [
      { provider: this.config.l1, tier: "L1" as const },
      { provider: this.config.l2, tier: "L2" as const },
      { provider: this.config.l3, tier: "L3" as const },
    ];
    return tiers.find((t) => t.provider.providerId === providerId);
  }
}
