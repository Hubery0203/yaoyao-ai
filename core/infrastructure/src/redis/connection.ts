import { Redis } from "ioredis";
import type { AppConfig } from "../config/env.js";

/**
 * Redis connection factory.
 *
 * Redis is coordination-only: TTL idempotency cache, short distributed locks,
 * BullMQ job coordination (Phase 9+). It is disposable/rebuildable and must
 * never be the sole record of a Core fact (Technical Proposal §11).
 */
export function createRedisConnection(config: AppConfig): Redis | null {
  if (!config.REDIS_URL) {
    return null;
  }
  const redis = new Redis(config.REDIS_URL, {
    // Required by BullMQ: blocking commands must not time out per-request.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  redis.on("error", (err) => {
    // Connection errors are reported by the host's logger; the connection
    // itself stays alive for retries. Core facts are never at risk here.
    void err;
  });
  return redis;
}
