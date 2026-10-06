/**
 * User mapper — guarded hydration via User.reconstitute().
 */
import {
  User,
  type UserId,
  type UserStatus,
} from "@yaoyao/domain";
import { users } from "../schema/index.js";
import {
  asDate,
  branded,
  hydrate,
} from "./primitives.js";

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

const TABLE = "users";

export function toUserRow(
  user: User,
  input: { email: string; passwordHash: string },
): UserInsert {
  return {
    userId: user.userId as string,
    email: input.email,
    passwordHash: input.passwordHash,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function fromUserRow(row: UserRow): User {
  return hydrate(TABLE, row.userId, () =>
    User.reconstitute({
      userId: branded<UserId>(row.userId, "user_id", TABLE),
      status: row.status as UserStatus,
      createdAt: asDate(row.createdAt, "created_at", TABLE),
      updatedAt: asDate(row.updatedAt, "updated_at", TABLE),
    }),
  );
}
