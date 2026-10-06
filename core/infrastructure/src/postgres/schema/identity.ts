/**
 * Core identity tables: users, yaoyaos, relationships.
 *
 * CHECK constraints here mirror frozen domain invariants as defense-in-depth
 * only (Technical Proposal v0.2 §A). They guard against defective adapters
 * and manual mistakes; they never become the authority for identity or
 * relationship rules — the domain is.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext } from "./custom.js";

const tz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey(),
    email: citext("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull(),
    createdAt: tz("created_at"),
    updatedAt: tz("updated_at"),
  },
  (t) => [
    check("users_password_hash_nonempty", sql`length(${t.passwordHash}) > 0`),
    check("users_status_allowed", sql`${t.status} IN ('active','suspended')`),
    check("users_chronology", sql`${t.updatedAt} >= ${t.createdAt}`),
    index("users_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const yaoyaos = pgTable(
  "yaoyaos",
  {
    yaoyaoId: uuid("yaoyao_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.userId, { onDelete: "restrict" }),
    identityKey: text("identity_key").notNull(),
    identityVersion: text("identity_version").notNull(),
    status: text("status").notNull(),
    createdAt: tz("created_at"),
    updatedAt: tz("updated_at"),
  },
  (t) => [
    // Defense-in-depth: the identity anchor is shen_zhiyao (domain literal type).
    check("yaoyaos_identity_key", sql`${t.identityKey} = 'shen_zhiyao'`),
    check(
      "yaoyaos_identity_version_nonempty",
      sql`length(${t.identityVersion}) > 0`,
    ),
    check("yaoyaos_status_active", sql`${t.status} = 'active'`),
    check("yaoyaos_chronology", sql`${t.updatedAt} >= ${t.createdAt}`),
    // Composite key target for ownership FKs from dependent tables.
    uniqueIndex("yaoyaos_user_yaoyao_uidx").on(t.userId, t.yaoyaoId),
  ],
);

const metric = (name: string) =>
  numeric(name, { precision: 5, scale: 4 })
    .notNull()
    .$type<string>();

export const relationships = pgTable(
  "relationships",
  {
    relationshipId: uuid("relationship_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    terminationAllowed: boolean("termination_allowed").notNull(),
    intimacy: metric("intimacy"),
    trust: metric("trust"),
    familiarity: metric("familiarity"),
    affection: metric("affection"),
    hurt: metric("hurt"),
    conflict: metric("conflict"),
    createdAt: tz("created_at"),
    updatedAt: tz("updated_at"),
  },
  (t) => [
    // Composite ownership FK: a relationship can only attach to a YaoYao
    // owned by the same user.
    foreignKey({
      name: "relationships_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    check("relationships_type", sql`${t.type} = 'deep_partner'`),
    check("relationships_status", sql`${t.status} = 'active'`),
    check(
      "relationships_termination_forbidden",
      sql`${t.terminationAllowed} = false`,
    ),
    check("relationships_intimacy_01", sql`${t.intimacy} >= 0 AND ${t.intimacy} <= 1`),
    check("relationships_trust_01", sql`${t.trust} >= 0 AND ${t.trust} <= 1`),
    check(
      "relationships_familiarity_01",
      sql`${t.familiarity} >= 0 AND ${t.familiarity} <= 1`,
    ),
    check(
      "relationships_affection_01",
      sql`${t.affection} >= 0 AND ${t.affection} <= 1`,
    ),
    check("relationships_hurt_01", sql`${t.hurt} >= 0 AND ${t.hurt} <= 1`),
    check("relationships_conflict_01", sql`${t.conflict} >= 0 AND ${t.conflict} <= 1`),
    check("relationships_chronology", sql`${t.updatedAt} >= ${t.createdAt}`),
    uniqueIndex("relationships_owner_uidx").on(t.userId, t.yaoyaoId),
  ],
);
