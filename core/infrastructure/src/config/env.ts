import { z } from "zod";

/**
 * Validated runtime configuration (Technical Proposal §14 — secrets are never
 * committed; they arrive via environment / secret files).
 *
 * Variables are introduced per phase; anything marked [Phase N] becomes
 * required when that phase lands. Phase 1 requires only the basics below.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // [Phase 3] PostgreSQL 16 + pgvector — the only system of record.
  DATABASE_URL: z.string().url().optional(),

  // Redis — idempotency cache, short distributed locks, BullMQ coordination.
  // Disposable/rebuildable; never the sole record of a Core fact.
  REDIS_URL: z.string().url().optional(),

  // [Phase 4] Auth.
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_ISSUER: z.string().default("yaoyao-ai"),
  JWT_AUDIENCE: z.string().default("yaoyao-app"),

  // [MVP-002C] AI providers. Keys live ONLY in server env / secret manager —
  // never in client bundles, logs, traces, or API responses.
  DEEPSEEK_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  // Tier provider selection. "mock" is always available (no key needed).
  // No single model is frozen as YaoYao's primary — this is configuration,
  // changeable without touching Core (I-014).
  LLM_L1_PROVIDER: z.enum(["mock", "deepseek", "openai"]).default("mock"),
  LLM_L2_PROVIDER: z.enum(["mock", "deepseek", "openai"]).default("mock"),
  LLM_L3_PROVIDER: z.enum(["mock", "deepseek", "openai"]).default("mock"),
  LLM_FALLBACK_PROVIDER: z.enum(["mock", "deepseek", "openai"]).default("mock"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = "ConfigError";
  }
}

/** Load and validate configuration. Throws ConfigError on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ConfigError(details);
  }
  return parsed.data;
}
