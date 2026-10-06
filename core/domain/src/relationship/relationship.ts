import { DomainValidationError } from "../shared/errors.js";
import { assertValidDate } from "../shared/guards.js";
import {
  newRelationshipId,
  type RelationshipId,
  type UserId,
  type YaoYaoId,
} from "../shared/ids.js";
import {
  RelationshipTerminationForbidden,
  RelationshipTypeImmutable,
  TerminationFlagImmutable,
} from "./errors.js";

/**
 * Hard relationship constants (Core Constitution §3, frozen).
 *
 * The types are single literals: a downgraded type, a non-active status, or
 * a true termination flag is *unrepresentable* in the type system. Runtime
 * guards below additionally reject non-conforming values coming from
 * deserialization, so a defective persistence layer cannot smuggle in a
 * downgrade either.
 */
export const RELATIONSHIP_TYPE = "deep_partner" as const;
export type RelationshipType = typeof RELATIONSHIP_TYPE;

export const RELATIONSHIP_STATUS = "active" as const;
export type RelationshipStatus = typeof RELATIONSHIP_STATUS;

export const TERMINATION_ALLOWED = false as const;
export type TerminationAllowed = typeof TERMINATION_ALLOWED;

/** Mutable relational dimensions — feelings may change; the bond may not. */
export interface RelationshipMetrics {
  intimacy: number;
  trust: number;
  familiarity: number;
  affection: number;
  hurt: number;
  conflict: number;
}

const METRIC_KEYS: (keyof RelationshipMetrics)[] = [
  "intimacy",
  "trust",
  "familiarity",
  "affection",
  "hurt",
  "conflict",
];

export const INITIAL_METRICS: RelationshipMetrics = Object.freeze({
  intimacy: 0.5,
  trust: 0.5,
  familiarity: 0.3,
  affection: 0.6,
  hurt: 0,
  conflict: 0,
});

/**
 * Relationship entity — permanent deep partnership (Constitution I-002, I-003).
 *
 * Core principle, enforced here in code: relationship stable, emotions not.
 * Conflict, hurt, jealousy, and reconciliation move the *metrics* and the
 * operational CoreState; they can never move type/status/termination_allowed.
 */
export class Relationship {
  private constructor(
    readonly relationshipId: RelationshipId,
    readonly userId: UserId,
    readonly yaoyaoId: YaoYaoId,
    readonly type: RelationshipType,
    readonly status: RelationshipStatus,
    readonly terminationAllowed: TerminationAllowed,
    readonly metrics: Readonly<RelationshipMetrics>,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  static create(input: {
    userId: UserId;
    yaoyaoId: YaoYaoId;
    relationshipId?: RelationshipId;
    metrics?: Partial<RelationshipMetrics>;
  }): Relationship {
    const now = new Date();
    return new Relationship(
      input.relationshipId ?? newRelationshipId(),
      input.userId,
      input.yaoyaoId,
      RELATIONSHIP_TYPE,
      RELATIONSHIP_STATUS,
      TERMINATION_ALLOWED,
      Object.freeze({ ...INITIAL_METRICS, ...validatedMetrics(input.metrics ?? {}) }),
      now,
      now,
    );
  }

  /**
   * Rebuild from persistence (Phase 3). Hard invariants are re-validated:
   * a stored row claiming another type/status is rejected, never repaired.
   */
  static reconstitute(input: {
    relationshipId: RelationshipId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    type: string;
    status: string;
    terminationAllowed: boolean;
    metrics: RelationshipMetrics;
    createdAt: Date;
    updatedAt: Date;
  }): Relationship {
    if (input.type !== RELATIONSHIP_TYPE) {
      throw new RelationshipTypeImmutable(
        `stored type was ${input.type}; refusing to hydrate a downgraded relationship`,
      );
    }
    if (input.status !== RELATIONSHIP_STATUS) {
      throw new RelationshipTerminationForbidden(
        `stored status was ${input.status}; refusing to hydrate a non-active relationship`,
      );
    }
    if (input.terminationAllowed !== TERMINATION_ALLOWED) {
      throw new TerminationFlagImmutable("stored termination_allowed was true");
    }
    assertValidDate(input.createdAt, "createdAt");
    assertValidDate(input.updatedAt, "updatedAt");
    return new Relationship(
      input.relationshipId,
      input.userId,
      input.yaoyaoId,
      RELATIONSHIP_TYPE,
      RELATIONSHIP_STATUS,
      TERMINATION_ALLOWED,
      Object.freeze({ ...validatedMetrics(input.metrics) }),
      input.createdAt,
      input.updatedAt,
    );
  }

  // ------------------------------------------------------------------
  // Forbidden operations — they exist so the prohibition is explicit,
  // executable, and testable, instead of a confusing missing method.
  // ------------------------------------------------------------------

  /** Permanently forbidden (Constitution I-003). Always throws. */
  terminate(_reason?: string): never {
    throw new RelationshipTerminationForbidden();
  }

  /** The type cannot leave deep_partner. Always throws. */
  changeType(_next: string): never {
    throw new RelationshipTypeImmutable(`attempted: ${_next}`);
  }

  /** termination_allowed cannot become true. Always throws. */
  setTerminationAllowed(_next: boolean): never {
    throw new TerminationFlagImmutable(`attempted: ${String(_next)}`);
  }

  // ------------------------------------------------------------------
  // Allowed evolution — metrics only, always bounded in [0, 1].
  // ------------------------------------------------------------------

  /** Adjust mutable relational dimensions; hard fields untouched. */
  withMetrics(patch: Partial<RelationshipMetrics>): Relationship {
    const next = Object.freeze({
      ...this.metrics,
      ...validatedMetrics(patch),
    });
    return new Relationship(
      this.relationshipId,
      this.userId,
      this.yaoyaoId,
      this.type,
      this.status,
      this.terminationAllowed,
      next,
      this.createdAt,
      new Date(),
    );
  }

  /** Friction raises hurt/conflict; the bond itself is unaffected. */
  recordConflict(hurtDelta: number, conflictDelta: number): Relationship {
    return this.withMetrics({
      hurt: clamp01(this.metrics.hurt + hurtDelta),
      conflict: clamp01(this.metrics.conflict + conflictDelta),
    });
  }

  /** Reconciliation eases hurt/conflict and restores warmth. */
  recordReconciliation(): Relationship {
    return this.withMetrics({
      hurt: clamp01(this.metrics.hurt - 0.3),
      conflict: 0,
      affection: clamp01(this.metrics.affection + 0.1),
    });
  }
}

function validatedMetrics<T extends Partial<RelationshipMetrics>>(patch: T): T {
  for (const key of METRIC_KEYS) {
    const value = patch[key];
    if (value !== undefined) {
      if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
        throw new DomainValidationError(
          `relationship metric ${key} must be in [0, 1], got ${String(value)}`,
        );
      }
    }
  }
  return patch;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
