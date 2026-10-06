import { DomainValidationError } from "../shared/errors.js";
import { assertNonEmptyString, assertValidDate } from "../shared/guards.js";
import { newYaoYaoId, type UserId, type YaoYaoId } from "../shared/ids.js";

/**
 * Identity anchor key. YaoYao is ALWAYS 沈知遥 / 遥遥.
 *
 * The key is a literal type: identity drift is unrepresentable in code.
 * identity_version identifies the identity *definition* revision (L1 growth),
 * never a session or process instance.
 */
export const IDENTITY_KEY_SHEN_ZHIYAO = "shen_zhiyao" as const;
export type IdentityKey = typeof IDENTITY_KEY_SHEN_ZHIYAO;

export const YAOYAO_STATUSES = ["active"] as const;
export type YaoYaoStatus = (typeof YAOYAO_STATUSES)[number];

/**
 * YaoYao entity — the persistent companion identity (Constitution L0).
 *
 * There is exactly one YaoYao per user in MVP (enforced by UNIQUE(user_id)
 * at persistence in Phase 3 and by YaoYaoAggregate composition here).
 * App restart, session end, provider change, or model upgrade never create
 * a second identity: identity survives all of them.
 */
export class YaoYao {
  private constructor(
    readonly yaoyaoId: YaoYaoId,
    readonly userId: UserId,
    readonly identityKey: IdentityKey,
    readonly identityVersion: string,
    readonly status: YaoYaoStatus,
    readonly createdAt: Date,
    readonly updatedAt: Date,
  ) {}

  static create(input: {
    userId: UserId;
    yaoyaoId?: YaoYaoId;
    identityVersion?: string;
  }): YaoYao {
    const now = new Date();
    return new YaoYao(
      input.yaoyaoId ?? newYaoYaoId(),
      input.userId,
      IDENTITY_KEY_SHEN_ZHIYAO,
      input.identityVersion ?? "0.1",
      "active",
      now,
      now,
    );
  }

  /** Rebuild from persistence (Phase 3). The identity key guard still applies. */
  static reconstitute(input: {
    yaoyaoId: YaoYaoId;
    userId: UserId;
    identityKey: string;
    identityVersion: string;
    status: YaoYaoStatus;
    createdAt: Date;
    updatedAt: Date;
  }): YaoYao {
    if (input.identityKey !== IDENTITY_KEY_SHEN_ZHIYAO) {
      throw new DomainValidationError(
        `identity key must be ${IDENTITY_KEY_SHEN_ZHIYAO}, got ${input.identityKey}`,
      );
    }
    assertNonEmptyString(input.identityVersion, "identityVersion");
    if (input.status !== "active") {
      throw new DomainValidationError(`unknown yaoyao status: ${input.status}`);
    }
    assertValidDate(input.createdAt, "createdAt");
    assertValidDate(input.updatedAt, "updatedAt");
    return new YaoYao(
      input.yaoyaoId,
      input.userId,
      IDENTITY_KEY_SHEN_ZHIYAO,
      input.identityVersion,
      "active",
      input.createdAt,
      input.updatedAt,
    );
  }

  /**
   * L1 growth: the identity *definition* may evolve (interests, understanding).
   * L0 (identity key) has no mutator — it cannot be changed, only re-read.
   */
  withIdentityVersion(version: string): YaoYao {
    assertNonEmptyString(version, "identityVersion");
    return new YaoYao(
      this.yaoyaoId,
      this.userId,
      this.identityKey,
      version,
      this.status,
      this.createdAt,
      new Date(),
    );
  }
}
