/**
 * PostgresUserRepository + PostgresYaoYaoAggregateRepository.
 */
import {
  EntityNotFoundError,
  type UserRepository,
  type YaoYaoAggregateRepository,
} from "@yaoyao/application";
import {
  User,
  YaoYaoAggregate,
  type UserId,
  type UserStatus,
} from "@yaoyao/domain";
import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { mapPgError } from "../errors.js";
import {
  fromRelationshipRow,
  fromUserRow,
  fromYaoYaoRow,
  toRelationshipRow,
  toUserRow,
  toYaoYaoRow,
} from "../mappers/index.js";
import {
  coreStates,
  relationships,
  users,
  yaoyaos,
} from "../schema/index.js";
import { fromCoreStateRow, toCoreStateRow } from "../mappers/index.js";

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findOwned(userId: UserId): Promise<User> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.userId, userId as string))
      .limit(1);
    if (rows.length === 0) throw new EntityNotFoundError("User");
    return fromUserRow(rows[0]);
  }

  async insert(input: {
    user: User;
    email: string;
    passwordHash: string;
  }): Promise<void> {
    try {
      await this.db
        .insert(users)
        .values(toUserRow(input.user, { email: input.email, passwordHash: input.passwordHash }));
    } catch (e) {
      throw mapPgError(e, "User");
    }
  }

  async save(
    userId: UserId,
    patch: { status: UserStatus; updatedAt: Date },
  ): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({ status: patch.status, updatedAt: patch.updatedAt })
      .where(eq(users.userId, userId as string))
      .returning();
    if (rows.length === 0) throw new EntityNotFoundError("User");
    return fromUserRow(rows[0]);
  }
}

export class PostgresYaoYaoAggregateRepository
  implements YaoYaoAggregateRepository
{
  constructor(private readonly db: Db) {}

  async loadOwned(userId: UserId): Promise<YaoYaoAggregate> {
    const uid = userId as string;
    const [yRow] = await this.db
      .select()
      .from(yaoyaos)
      .where(eq(yaoyaos.userId, uid))
      .limit(1);
    if (!yRow) throw new EntityNotFoundError("YaoYao");
    const [rRow] = await this.db
      .select()
      .from(relationships)
      .where(eq(relationships.userId, uid))
      .limit(1);
    if (!rRow) throw new EntityNotFoundError("Relationship");
    const [sRow] = await this.db
      .select()
      .from(coreStates)
      .where(eq(coreStates.userId, uid))
      .limit(1);
    if (!sRow) throw new EntityNotFoundError("CoreState");
    // Each member hydrates through its own guarded reconstitute(); the
    // composition guard then rejects any mismatched triple.
    return YaoYaoAggregate.reconstitute({
      yaoyao: fromYaoYaoRow(yRow),
      relationship: fromRelationshipRow(rRow),
      state: fromCoreStateRow(sRow),
    });
  }

  async insert(aggregate: YaoYaoAggregate): Promise<void> {
    try {
      await this.db.insert(yaoyaos).values(toYaoYaoRow(aggregate.yaoyao));
      await this.db
        .insert(relationships)
        .values(toRelationshipRow(aggregate.relationship));
      await this.db.insert(coreStates).values(toCoreStateRow(aggregate.state));
    } catch (e) {
      throw mapPgError(e, "YaoYaoAggregate");
    }
  }
}

/** Convenience: load the YaoYaoId for an owner (avoids a full aggregate load). */
export async function findYaoYaoIdOwned(
  db: Db,
  userId: UserId,
): Promise<string> {
  const [row] = await db
    .select({ yaoyaoId: yaoyaos.yaoyaoId })
    .from(yaoyaos)
    .where(eq(yaoyaos.userId, userId as string))
    .limit(1);
  if (!row) throw new EntityNotFoundError("YaoYao");
  return row.yaoyaoId;
}
