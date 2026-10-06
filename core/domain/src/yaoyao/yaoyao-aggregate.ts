import { DomainValidationError } from "../shared/errors.js";
import type { UserId } from "../shared/ids.js";
import { newYaoYaoId, type YaoYaoId } from "../shared/ids.js";
import { CoreState } from "../state/core-state.js";
import { Relationship } from "../relationship/relationship.js";
import { YaoYao } from "./yaoyao.js";

/**
 * YaoYaoAggregate — the persistent companion root.
 *
 * Coordinates exactly one YaoYao (identity), one Relationship (permanent
 * bond), and one CoreState (current condition) for a user — 1:1:1.
 * The aggregate guarantees all three share the same user_id/yaoyao_id;
 * a mismatched composition is rejected at construction.
 *
 * Transactional changes across the three (e.g. initialization) are applied
 * by the application layer in Phase 5; this aggregate is the composition
 * and invariant boundary.
 */
export class YaoYaoAggregate {
  private constructor(
    readonly yaoyao: YaoYao,
    readonly relationship: Relationship,
    readonly state: CoreState,
  ) {
    const ids = new Set([
      `${yaoyao.userId}:${yaoyao.yaoyaoId}`,
      `${relationship.userId}:${relationship.yaoyaoId}`,
      `${state.userId}:${state.yaoyaoId}`,
    ]);
    if (ids.size !== 1) {
      throw new DomainValidationError(
        "YaoYaoAggregate components must share the same user_id and yaoyao_id",
      );
    }
  }

  get userId(): UserId {
    return this.yaoyao.userId;
  }

  get yaoyaoId(): YaoYaoId {
    return this.yaoyao.yaoyaoId;
  }

  /** Build a fresh aggregate: one identity, one bond, one initial state. */
  static create(input: {
    userId: UserId;
    yaoyaoId?: YaoYaoId;
    identityVersion?: string;
  }): YaoYaoAggregate {
    const yaoyaoId = input.yaoyaoId ?? newYaoYaoId();
    const yaoyao = YaoYao.create({
      userId: input.userId,
      yaoyaoId,
      identityVersion: input.identityVersion,
    });
    const relationship = Relationship.create({
      userId: input.userId,
      yaoyaoId,
    });
    const state = CoreState.initial({ userId: input.userId, yaoyaoId });
    return new YaoYaoAggregate(yaoyao, relationship, state);
  }

  /** Rebuild from persistence (Phase 3). Composition guard still applies. */
  static reconstitute(input: {
    yaoyao: YaoYao;
    relationship: Relationship;
    state: CoreState;
  }): YaoYaoAggregate {
    return new YaoYaoAggregate(input.yaoyao, input.relationship, input.state);
  }

  withRelationship(relationship: Relationship): YaoYaoAggregate {
    return new YaoYaoAggregate(this.yaoyao, relationship, this.state);
  }

  withState(state: CoreState): YaoYaoAggregate {
    return new YaoYaoAggregate(this.yaoyao, this.relationship, state);
  }

  withYaoYao(yaoyao: YaoYao): YaoYaoAggregate {
    return new YaoYaoAggregate(yaoyao, this.relationship, this.state);
  }
}
