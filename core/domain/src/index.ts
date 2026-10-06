/**
 * @yaoyao/domain — YaoYao Core domain layer.
 *
 * HARD RULE: standard library only. No framework, ORM, driver, or provider
 * imports. Enforced by dependency-cruiser (domain-is-framework-free).
 *
 * Entities are immutable: behavior methods return new instances. This makes
 * state transitions causally traceable and stale-write rejection natural.
 */

// shared
export {
  uuidv7,
  isUuidV7,
  newUserId,
  newYaoYaoId,
  newRelationshipId,
  newStateId,
  newSessionId,
  newEventId,
  newMemoryContainerId,
  newMemoryId,
} from "./shared/ids.js";
export type {
  UserId,
  YaoYaoId,
  RelationshipId,
  StateId,
  SessionId,
  EventId,
  MemoryContainerId,
  MemoryId,
} from "./shared/ids.js";
export {
  DomainError,
  InvariantViolationError,
  DomainValidationError,
} from "./shared/errors.js";

// user
export { User, USER_STATUSES } from "./user/user.js";
export type { UserStatus } from "./user/user.js";

// yaoyao
export {
  YaoYao,
  IDENTITY_KEY_SHEN_ZHIYAO,
} from "./yaoyao/yaoyao.js";
export type { IdentityKey, YaoYaoStatus } from "./yaoyao/yaoyao.js";
export { YaoYaoAggregate } from "./yaoyao/yaoyao-aggregate.js";

// relationship
export {
  Relationship,
  RELATIONSHIP_TYPE,
  RELATIONSHIP_STATUS,
  TERMINATION_ALLOWED,
  INITIAL_METRICS,
} from "./relationship/relationship.js";
export type {
  RelationshipType,
  RelationshipStatus,
  TerminationAllowed,
  RelationshipMetrics,
} from "./relationship/relationship.js";
export {
  RelationshipInvariantError,
  RelationshipTerminationForbidden,
  RelationshipTypeImmutable,
  TerminationFlagImmutable,
} from "./relationship/errors.js";

// state
export {
  EmotionVector,
  EMOTION_DIMENSIONS,
  INITIAL_EMOTION,
} from "./state/emotion.js";
export type { EmotionDimension, EmotionValues } from "./state/emotion.js";
export {
  CoreState,
  StaleStateVersionError,
  OPERATIONAL_STATES,
} from "./state/core-state.js";
export type {
  OperationalRelationshipState,
  InternalState,
  CoreStateChanges,
} from "./state/core-state.js";

// session
export { Session, SESSION_STATUSES } from "./session/session.js";
export type { SessionStatus } from "./session/session.js";

// event
export {
  DomainEvent,
  EVENT_TYPES,
  EVENT_ACTORS,
  EVENT_SOURCES,
} from "./event/event.js";
export type { EventType, EventActor, EventSource } from "./event/event.js";

// memory
export {
  Memory,
  MEMORY_TYPES,
  MEMORY_STATUSES,
} from "./memory/memory.js";
export type { MemoryType, MemoryStatus } from "./memory/memory.js";
