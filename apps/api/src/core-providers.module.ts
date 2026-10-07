import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import {
  AUTH_CREDENTIALS,
  CONTEXT_DATA,
  HEALTH_PROBE,
  MEMORY_RETRIEVAL,
  PASSWORD_HASHER,
  TOKEN_SERVICE,
  TRANSACTION_MANAGER,
  type MemoryRetrieval,
} from "@yaoyao/application";
import {
  Argon2PasswordHasher,
  DeepSeekAdapter,
  JwtTokenService,
  OpenAIAdapter,
  PostgresAuthCredentialRepository,
  PostgresHealthProbe,
  PostgresMemoryRetrievalAdapter,
  PostgresTransactionManager,
  createPgPool,
  loadConfig,
  schema,
  tokenServiceOptionsFromConfig,
  type AppConfig,
} from "@yaoyao/infrastructure";
import {
  CONVERSATION_ORCHESTRATOR,
  AIRouter,
  ConversationOrchestrator,
  MockLLMProvider,
} from "@yaoyao/runtime";
import { TransactionalContextDataAdapter } from "./persona-context.adapter.js";
import type { LLMProvider } from "@yaoyao/application";

/**
 * Build an LLMProvider from a configured provider name.
 * "mock" needs no key; deepseek/openai fail fast when the key is missing
 * (the adapter constructor throws ProviderError AUTH_ERROR).
 */
function buildProvider(
  name: "mock" | "deepseek" | "openai",
  config: AppConfig,
): LLMProvider {
  switch (name) {
    case "deepseek":
      return new DeepSeekAdapter({
        apiKey: config.DEEPSEEK_API_KEY ?? "",
        modelId: config.DEEPSEEK_MODEL,
      });
    case "openai":
      return new OpenAIAdapter({
        apiKey: config.OPENAI_API_KEY ?? "",
        modelId: config.OPENAI_MODEL,
      });
    case "mock":
    default:
      return new MockLLMProvider();
  }
}
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

const APP_CONFIG = "YAOYAO_APP_CONFIG";
const PG_POOL = "YAOYAO_PG_POOL";

/**
 * Global infrastructure providers for the API host.
 *
 * @Global() makes these available to every feature module's controllers
 * (NestJS scoping: a controller can only inject providers from its own
 * module or imported modules' exports — AppModule-level providers are
 * NOT visible downward, hence a global module).
 *
 * Composition only: implementations come from @yaoyao/infrastructure,
 * interfaces from @yaoyao/application. No business logic here.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(),
    },
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        if (!config.DATABASE_URL) {
          throw new Error(
            "DATABASE_URL is required for the API host; refusing to start",
          );
        }
        return createPgPool({ connectionString: config.DATABASE_URL });
      },
    },
    {
      provide: TRANSACTION_MANAGER,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PostgresTransactionManager(pool),
    },
    {
      provide: PASSWORD_HASHER,
      useClass: Argon2PasswordHasher,
    },
    {
      provide: TOKEN_SERVICE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new JwtTokenService(tokenServiceOptionsFromConfig(config)),
    },
    {
      provide: AUTH_CREDENTIALS,
      inject: [PG_POOL],
      useFactory: (pool: Pool) =>
        new PostgresAuthCredentialRepository(drizzle(pool, { schema })),
    },
    {
      provide: HEALTH_PROBE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PostgresHealthProbe(pool),
    },
    // MVP-002C: AI Router wiring. Tier providers are config-selected
    // (mock/deepseek/openai); no model is frozen as YaoYao's primary (I-014).
    // API keys come from server-side env only — never logged, never traced.
    {
      provide: "YAOYAO_AI_ROUTER",
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new AIRouter({
          l1: buildProvider(config.LLM_L1_PROVIDER, config),
          l2: buildProvider(config.LLM_L2_PROVIDER, config),
          l3: buildProvider(config.LLM_L3_PROVIDER, config),
          fallback: buildProvider(config.LLM_FALLBACK_PROVIDER, config),
        }),
    },
    // MVP-002B: Context data wiring. The adapter composes MVP-001 read
    // use cases inside a scoped read transaction (read-only).
    {
      provide: CONTEXT_DATA,
      useClass: TransactionalContextDataAdapter,
    },
    // MVP-002D: Memory Retrieval wiring. Postgres adapter, SELECT-only.
    // Owner-scoped (user_id, yaoyao_id) with RLS pinned per retrieve();
    // yaoyaoId is server-resolved. Takes the raw pool (not a Drizzle Db)
    // so each retrieve() can pin its own RLS owner context.
    {
      provide: MEMORY_RETRIEVAL,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PostgresMemoryRetrievalAdapter(pool),
    },
    {
      provide: CONVERSATION_ORCHESTRATOR,
      inject: ["YAOYAO_AI_ROUTER", CONTEXT_DATA, MEMORY_RETRIEVAL],
      useFactory: (router: AIRouter, contextData, memoryRetrieval: MemoryRetrieval) =>
        new ConversationOrchestrator({ router, contextData, memoryRetrieval }),
    },
  ],
  exports: [
    TRANSACTION_MANAGER,
    PASSWORD_HASHER,
    TOKEN_SERVICE,
    AUTH_CREDENTIALS,
    HEALTH_PROBE,
    "YAOYAO_AI_ROUTER",
    CONTEXT_DATA,
    MEMORY_RETRIEVAL,
    CONVERSATION_ORCHESTRATOR,
  ],
})
export class CoreProvidersModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Drain the pg pool on shutdown. Without this, app.close() leaves
   * connections open; when the Testcontainers postgres is stopped the
   * server terminates them (57P01) and the orphaned clients surface as
   * uncaught exceptions that fail the CI run.
   */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
