import { createLogger, createRedisConnection, loadConfig } from "@yaoyao/infrastructure";

/**
 * Worker host bootstrap — BullMQ background-job host.
 *
 * MVP-001 Phase 1: the host boots, connects to Redis when configured, and
 * registers NO queues. Scheduler/proactive evaluation interfaces arrive with
 * later milestones (Proactive is MVP-009; BullMQ is coordination-only and
 * never authoritative — Technical Proposal §02).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config).child({ host: "worker" });

  const redis = createRedisConnection(config);
  if (!redis) {
    logger.warn(
      "REDIS_URL not set — worker idle. Coordination wiring lands with Phase 3+.",
    );
  } else {
    logger.info("worker online; no queues registered in MVP-001 Phase 1");
  }

  // Keep the event loop alive until a shutdown signal arrives.
  // (A never-resolving promise alone does not prevent Node from exiting
  // when no handles are pending.)
  const keepAlive = setInterval(() => undefined, 30_000);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(keepAlive);
    logger.info({ signal }, "worker shutting down");
    if (redis) {
      await redis.quit().catch(() => undefined);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Real queue processors attach in later phases; the host simply idles here.
  await new Promise<void>(() => undefined);
}

main().catch((err: unknown) => {
  console.error("Worker bootstrap failed:", err);
  process.exit(1);
});
