/**
 * Branded identity types + UUIDv7 generation.
 *
 * Standard library only (node:crypto). UUIDv7 is used for event_id and all
 * entity identifiers (Technical Proposal §06): time-ordered, globally unique.
 */

declare const brand: unique symbol;
type Brand<T, Name> = T & { readonly [brand]: Name };

export type UserId = Brand<string, "UserId">;
export type YaoYaoId = Brand<string, "YaoYaoId">;
export type RelationshipId = Brand<string, "RelationshipId">;
export type StateId = Brand<string, "StateId">;
export type SessionId = Brand<string, "SessionId">;
export type EventId = Brand<string, "EventId">;
export type MemoryContainerId = Brand<string, "MemoryContainerId">;
export type MemoryId = Brand<string, "MemoryId">;

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Generate a UUIDv7 (48-bit unix-ms timestamp + 74 random bits).
 * Uses only the Node standard library.
 */
export function uuidv7(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const ms = Date.now();
  buf[0] = Math.floor(ms / 2 ** 40) % 256;
  buf[1] = Math.floor(ms / 2 ** 32) % 256;
  buf[2] = Math.floor(ms / 2 ** 24) % 256;
  buf[3] = Math.floor(ms / 2 ** 16) % 256;
  buf[4] = Math.floor(ms / 2 ** 8) % 256;
  buf[5] = ms % 256;
  buf[6] = 0x70 | (buf[6] & 0x0f); // version 7
  buf[8] = 0x80 | (buf[8] & 0x3f); // variant 10xx
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}` +
    `-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_RE.test(value);
}

export function newUserId(): UserId {
  return uuidv7() as UserId;
}
export function newYaoYaoId(): YaoYaoId {
  return uuidv7() as YaoYaoId;
}
export function newRelationshipId(): RelationshipId {
  return uuidv7() as RelationshipId;
}
export function newStateId(): StateId {
  return uuidv7() as StateId;
}
export function newSessionId(): SessionId {
  return uuidv7() as SessionId;
}
export function newEventId(): EventId {
  return uuidv7() as EventId;
}
export function newMemoryContainerId(): MemoryContainerId {
  return uuidv7() as MemoryContainerId;
}
export function newMemoryId(): MemoryId {
  return uuidv7() as MemoryId;
}
