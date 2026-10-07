/**
 * Context data port — MVP-002B Persona Runtime + Context Assembly.
 *
 * The runtime needs to READ Core data (identity, relationship, state,
 * recent events) to build the cognitive context. It must never reach
 * infrastructure directly, so this port abstracts the reads.
 *
 * The port returns DOMAIN AGGREGATES. Projection into model-safe context
 * (B09: Database Entity ≠ Model Context) happens inside @yaoyao/runtime
 * (Persona Runtime + Context Assembly) — never here, never in the
 * infrastructure.
 *
 * Read-only by contract: no method on this port writes anything.
 */
import type {
  CoreState,
  DomainEvent,
  Relationship,
  UserId,
  YaoYaoAggregate,
} from "@yaoyao/domain";

export interface PersonaData {
  readonly yaoyao: YaoYaoAggregate;
  readonly relationship: Relationship;
  readonly state: CoreState;
  readonly recentEvents: ReadonlyArray<DomainEvent>;
}

export interface ContextDataPort {
  /**
   * Load all Core data needed for Persona Runtime + Context Assembly.
   * Resolves the real yaoyaoId from the userId (fixes TD-M002A-001).
   * Throws when the user has no YaoYao (fail-closed, no placeholder).
   */
  loadPersonaData(userId: UserId): Promise<PersonaData>;
}

/** NestJS injection token for the ContextDataPort. */
export const CONTEXT_DATA = "YAOYAO_CONTEXT_DATA";
