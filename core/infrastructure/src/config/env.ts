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
  CONVERSATION_MODEL_BUDGET_MS: z.coerce.number().int().min(5000).max(90000).default(45000),
  CONVERSATION_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(2000).default(2000),
  EMOTION_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(2000).default(512),
  PERFORMANCE_LOG_EVERY: z.coerce.number().int().min(1).max(100).default(10),
  PHOTOS_ENABLED: z.enum(["0","1"]).default("0"),
  OPENAI_IMAGE_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.enum(["gpt-image-2.5-sunburst","gpt-image-2.5-flare","gpt-image-2","gpt-image-1.5"]).default("gpt-image-2.5-sunburst"),
  PHOTO_REFERENCE_FILE: z.string().optional(),
  PHOTO_STORAGE_DIR: z.string().optional(),
  PHOTO_MAX_PER_24H: z.coerce.number().int().min(1).max(5).default(3),
  WEIXIN_ENABLED: z.enum(["0","1"]).default("0"),
  WEIXIN_CREDENTIALS_FILE: z.string().min(1).optional(),
  LITE_MODE: z.enum(["0","1"]).default("0"),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(10).default(10),
  HOST: z.enum(["127.0.0.1", "0.0.0.0", "::1"]).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // [Phase 3] PostgreSQL 16 + pgvector — the only system of record.
  DATABASE_URL: z.string().url().optional(),

  CONTINUITY_USER_IDS: z.string().default("").transform(value=>value.split(",").map(s=>s.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).max(100)),
  CONTINUITY_POLL_MS: z.coerce.number().int().min(100).max(60000).default(2000),
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
