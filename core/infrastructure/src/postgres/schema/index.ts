/**
 * Postgres schema barrel — the single schema object Drizzle binds to.
 */
export * from "./custom.js";
export * from "./identity.js";
export * from "./state.js";
export * from "./memory.js";
export * from "./session-events.js";
export * from "./delivery.js";

import { events } from "./session-events.js";
import { idempotencyRecords, outbox, refreshSessions, schemaMigrations } from "./delivery.js";
import { relationships, users, yaoyaos } from "./identity.js";
import { memories, memoryContainers } from "./memory.js";
import { sessions } from "./session-events.js";
import { coreStates } from "./state.js";

export const schema = {
  users,
  yaoyaos,
  relationships,
  coreStates,
  memoryContainers,
  memories,
  sessions,
  events,
  refreshSessions,
  idempotencyRecords,
  outbox,
  schemaMigrations,
};

export type Schema = typeof schema;
