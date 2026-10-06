import { DomainError } from "../shared/errors.js";
import { DomainValidationError } from "../shared/errors.js";
import { assertUnitInterval, assertValidDate } from "../shared/guards.js";
import {
  newStateId,
  type StateId,
  type UserId,
  type YaoYaoId,
} from "../shared/ids.js";
import { EmotionVector, type EmotionValues } from "./emotion.js";

/** Thrown when a transition targets a stale state version (T010). */
export class StaleStateVersionError extends DomainError {
  readonly expected: number;
  readonly current: number;

  constructor(expected: number, current: number) {
    super(
      "STALE_STATE_VERSION",
      `State changed; reload and retry the command (expected ${expected}, current ${current}).`,
    );
    this.expected = expected;
    this.current = current;
  }
}

/**
 * Operational relationship state — how the relationship *feels* right now.
 * This is NOT Relationship.status: the bond stays deep_partner/active while
 * the operational state moves through hurt/conflict/reconciliation.
 */
export const OPERATIONAL_STATES = [
  "calm",
  "affectionate",
  "hurt",
  "conflicted",
  "reconciled",
] as const;
export type OperationalRelationshipState = (typeof OPERATIONAL_STATES)[number];

export interface InternalState {
  currentThought?: string;
  recentReflection?: string;
  currentInterest?: string;
  curiosity?: string;
  unfinishedThought?: string;
  personalGoal?: string;
  internalMood?: string;
}

export interface CoreStateChanges {
  emotion?: Partial<EmotionValues>;
  energy?: number;
  socialState?: string;
  relationshipState?: OperationalRelationshipState;
  attention?: string;
  internalState?: Partial<InternalState>;
}

/**
 * CoreState — versioned snapshot of "what YaoYao is like now".
 *
 * Neither identity (YaoYao) nor history (EventLog): a mutable runtime
 * condition with optimistic-concurrency protection. Every transition bumps
 * state_version; a stale expectedVersion is rejected, never blind-overwritten.
 * The production emotion algorithm arrives in MVP-005; this milestone
 * provides persistence shape, bounds, versioning, and traceability.
 */
export class CoreState {
  private constructor(
    readonly stateId: StateId,
    readonly userId: UserId,
    readonly yaoyaoId: YaoYaoId,
    readonly emotion: EmotionVector,
    readonly energy: number,
    readonly socialState: string,
    readonly relationshipState: OperationalRelationshipState,
    readonly attention: string,
    readonly internalState: Readonly<InternalState>,
    readonly stateVersion: number,
    readonly lastUpdated: Date,
  ) {}

  static initial(input: {
    userId: UserId;
    yaoyaoId: YaoYaoId;
    stateId?: StateId;
  }): CoreState {
    const now = new Date();
    return new CoreState(
      input.stateId ?? newStateId(),
      input.userId,
      input.yaoyaoId,
      EmotionVector.initial(),
      0.8,
      "resting",
      "calm",
      "",
      Object.freeze({}),
      1,
      now,
    );
  }

  /** Rebuild from persistence (Phase 3). Bounds still apply. */
  static reconstitute(input: {
    stateId: StateId;
    userId: UserId;
    yaoyaoId: YaoYaoId;
    emotion: EmotionValues;
    energy: number;
    socialState: string;
    relationshipState: OperationalRelationshipState;
    attention: string;
    internalState: InternalState;
    stateVersion: number;
    lastUpdated: Date;
  }): CoreState {
    assertUnitInterval(input.energy, "energy");
    if (!OPERATIONAL_STATES.includes(input.relationshipState)) {
      throw new DomainValidationError(
        `unknown operational relationship state: ${input.relationshipState}`,
      );
    }
    if (!Number.isInteger(input.stateVersion) || input.stateVersion < 1) {
      throw new DomainValidationError(
        `stateVersion must be an integer >= 1, got ${input.stateVersion}`,
      );
    }
    assertValidDate(input.lastUpdated, "lastUpdated");
    return new CoreState(
      input.stateId,
      input.userId,
      input.yaoyaoId,
      EmotionVector.create(input.emotion),
      input.energy,
      input.socialState,
      input.relationshipState,
      input.attention,
      Object.freeze({ ...input.internalState }),
      input.stateVersion,
      input.lastUpdated,
    );
  }

  /**
   * Compare-and-swap transition envelope (pure domain form of T010).
   *
   * The caller reads (state, stateVersion = N), computes changes, and commits
   * only if the version is still N. On mismatch the transition is rejected
   * so the caller reloads and recomputes — never a blind overwrite.
   */
  transition(expectedVersion: number, changes: CoreStateChanges): CoreState {
    if (expectedVersion !== this.stateVersion) {
      throw new StaleStateVersionError(expectedVersion, this.stateVersion);
    }
    if (changes.energy !== undefined) {
      assertUnitInterval(changes.energy, "energy");
    }
    if (
      changes.relationshipState !== undefined &&
      !OPERATIONAL_STATES.includes(changes.relationshipState)
    ) {
      throw new DomainValidationError(
        `unknown operational relationship state: ${changes.relationshipState}`,
      );
    }
    return new CoreState(
      this.stateId,
      this.userId,
      this.yaoyaoId,
      changes.emotion ? this.emotion.with(changes.emotion) : this.emotion,
      changes.energy ?? this.energy,
      changes.socialState ?? this.socialState,
      changes.relationshipState ?? this.relationshipState,
      changes.attention ?? this.attention,
      Object.freeze({ ...this.internalState, ...(changes.internalState ?? {}) }),
      this.stateVersion + 1,
      new Date(),
    );
  }
}
