/**
 * PostgreSQL connection factory.
 *
 * Pools are created per role: the migration/deploy job uses a privileged
 * pool, runtime uses the least-privilege yaoyao_app pool. Credentials
 * arrive via environment/secret files — never baked into images.
 */
import { Pool, type PoolConfig } from "pg";

export interface PgPoolOptions {
  connectionString: string;
  max?: number;
  statementTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
  lockTimeoutMs?: number;
}

export function createPgPool(options: PgPoolOptions): Pool {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    idle_in_transaction_session_timeout:
      options.idleInTransactionTimeoutMs ?? 30_000,
    lock_timeout: options.lockTimeoutMs ?? 10_000,
  };
  return new Pool(config);
}
