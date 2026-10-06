/**
 * Shared Drizzle database handle type for repositories.
 *
 * Repositories are constructed per transaction: the TransactionManager
 * binds a Drizzle instance to the transaction's dedicated pg client, so
 * every repository call inside a use case shares one transaction handle.
 * Repositories never commit independently.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { schema } from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;
