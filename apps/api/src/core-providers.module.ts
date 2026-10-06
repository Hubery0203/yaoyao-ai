import { Global, Module } from "@nestjs/common";
import {
  AUTH_CREDENTIALS,
  HEALTH_PROBE,
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
  ],
  exports: [
    TRANSACTION_MANAGER,
    PASSWORD_HASHER,
    TOKEN_SERVICE,
    AUTH_CREDENTIALS,
    HEALTH_PROBE,
  ],
})
export class CoreProvidersModule {}
