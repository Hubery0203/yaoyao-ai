import { DomainValidationError } from "../shared/errors.js";
import { assertValidDate, assertNonEmptyString } from "../shared/guards.js";
import { newUserId, type UserId } from "../shared/ids.js";

export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * User aggregate — authentication identity and ownership anchor.
 *
 * BOUNDARY: User owns identity/auth concerns only. All companion state
 * (YaoYao, Relationship, CoreState, Session, Event, Memory) lives in
 * YaoYaoAggregate and related entities, linked by user_id. The User
 * aggregate never reaches into companion state, and companion entities
 * never mutate the User.
 */
export class User {
  private constructor(
    readonly userId: UserId,
    readonly status: UserStatus,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  static create(input: { userId?: UserId; status?: UserStatus } = {}): User {
    const now = new Date();
    const status = input.status ?? "active";
    if (!USER_STATUSES.includes(status)) {
      throw new DomainValidationError(`unknown user status: ${status}`);
    }
    return new User(input.userId ?? newUserId(), status, now, now);
  }

  /** Rebuild from persistence (Phase 3). Guards still apply. */
  static reconstitute(input: {
    userId: UserId;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    assertNonEmptyString(input.userId, "userId");
    if (!USER_STATUSES.includes(input.status)) {
      throw new DomainValidationError(`unknown user status: ${input.status}`);
    }
    assertValidDate(input.createdAt, "createdAt");
    assertValidDate(input.updatedAt, "updatedAt");
    return new User(input.userId, input.status, input.createdAt, input.updatedAt);
  }

  get isActive(): boolean {
    return this.status === "active";
  }

  suspend(): User {
    return new User(this.userId, "suspended", this.createdAt, new Date());
  }

  reactivate(): User {
    return new User(this.userId, "active", this.createdAt, new Date());
  }
}
