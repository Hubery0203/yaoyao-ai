/**
 * Database health probe (Phase 4).
 *
 * Runs SELECT 1 with a short timeout. Any failure (unreachable,
 * auth error, timeout) is "degraded" — the probe never throws, so a
 * sick database degrades readiness instead of crashing the endpoint.
 */
import type { HealthProbe } from "@yaoyao/application";
import type { Pool } from "pg";

export class PostgresHealthProbe implements HealthProbe {
  constructor(private readonly pool: Pool) {}

  async checkDatabase(): Promise<"ok" | "degraded"> {
    try {
      await this.pool.query("SELECT 1");
      return "ok";
    } catch {
      return "degraded";
    }
  }
}
