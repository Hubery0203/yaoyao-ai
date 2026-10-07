/**
 * @yaoyao/infrastructure — implements application ports.
 *
 * postgres/ : Drizzle mappings, repositories, roles, RLS, append-only controls — Phase 3.
 * redis/     : coordination-only connection factory (this phase).
 * auth/      : Argon2id, JWT access + rotating refresh sessions — Phase 4.
 * observability/ : pino structured logging with redaction (this phase).
 * providers/ : LLM/Vision/STT/TTS interfaces — seams only, NO SDKs in MVP-001.
 */
export { loadConfig, ConfigError } from "./config/env.js";
export type { AppConfig } from "./config/env.js";
export { createLogger } from "./observability/logger.js";
export { createRedisConnection } from "./redis/connection.js";
export { DeepSeekAdapter } from "./llm/deepseek.adapter.js";
export { OpenAIAdapter } from "./llm/openai.adapter.js";
export * from "./postgres/index.js";
export { Argon2PasswordHasher } from "./auth/password-hasher.js";
export {
  JwtTokenService,
  tokenServiceOptionsFromConfig,
} from "./auth/token-service.js";
export { PostgresAuthCredentialRepository } from "./auth/auth-credentials.js";
export { PostgresHealthProbe } from "./auth/health-probe.js";
