/**
 * PostgresTransactionManager — application-owned transaction scope.
 *
 * Each runAsUser() checks out a dedicated pg client from the pool, opens
 * one transaction, pins the RLS owner context transaction-locally
 * (SET LOCAL via set_config(..., true)), hands the use case a repository
 * bundle bound to that client, then commits or rolls back atomically.
 *
 * Because the owner context is transaction-local, pooled-connection reuse
 * cannot leak one user's context into another's — proven by the T008
 * isolation suite running against a shared pool.
 */
import type {
  PersistenceTransaction,
  TransactionManager,
} from "@yaoyao/application";
import type { UserId } from "@yaoyao/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { createRepositories } from "../repositories/index.js";
import { schema } from "../schema/index.js";

export class PostgresTransactionManager implements TransactionManager {
  constructor(private readonly pool: Pool) {}

  async runAsUser<T>(
    userId: UserId,
    fn: (tx: PersistenceTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Transaction-local owner context for RLS (is_local = true).
      await client.query("SELECT set_config('app.user_id', $1, true)", [
        userId as string,
      ]);
      const db = drizzle(client, { schema });
      const result = await fn(createRepositories(db));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Rollback failure must not mask the original error.
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
