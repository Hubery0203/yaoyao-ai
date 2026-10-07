import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import {
  AUTH_CREDENTIALS,
  CONTEXT_DATA,
  HEALTH_PROBE,
  LLM_PROVIDER,
  PASSWORD_HASHER,
  TOKEN_SERVICE,
  TRANSACTION_MANAGER,
} from "@yaoyao/application";
import {
  Argon2PasswordHasher,
  JwtTokenService,
  PostgresAuthCredentialRepository,
  PostgresHealthProbe,
  PostgresTransactionManager,
  createPgPool,
  loadConfig,
  schema,
  tokenServiceOptionsFromConfig,
  type AppConfig,
} from "@yaoyao/infrastructure";
import {
  CONVERSATION_ORCHESTRATOR,
  ConversationOrchestrator,
  MockLLMProvider,
} from "@yaoyao/runtime";
import { TransactionalContextDataAdapter } from "./persona-context.adapter.js";
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
    // MVP-002A: Conversation Runtime wiring. The LLM provider is the Mock
    // (echo path); production adapters arrive in MVP-002C. The orchestrator
    // is constructed with the provider — the ONLY model access path.
    {
      provide: LLM_PROVIDER,
      useClass: MockLLMProvider,
    },
    // MVP-002B: Context data wiring. The adapter composes MVP-001 read
    // use cases inside a scoped read transaction (read-only).
    {
      provide: CONTEXT_DATA,
      useClass: TransactionalContextDataAdapter,
    },
    {
      provide: CONVERSATION_ORCHESTRATOR,
      inject: [LLM_PROVIDER, CONTEXT_DATA],
      useFactory: (llm, contextData) =>
        new ConversationOrchestrator({ llm, contextData }),
    },
  ],
  exports: [
    TRANSACTION_MANAGER,
    PASSWORD_HASHER,
    TOKEN_SERVICE,
    AUTH_CREDENTIALS,
    HEALTH_PROBE,
    LLM_PROVIDER,
    CONTEXT_DATA,
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
