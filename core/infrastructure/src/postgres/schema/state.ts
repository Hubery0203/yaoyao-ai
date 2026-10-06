/**
 * core_states table — versioned operational snapshot.
 *
 * The emotion JSONB carries an object-shape CHECK only; the nine dimensions
 * and [0,1] bounds are validated by Domain hydration (EmotionVector.create).
 * state_version is the compare-and-swap target for optimistic concurrency.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { yaoyaos } from "./identity.js";

const tz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

export const coreStates = pgTable(
  "core_states",
  {
    stateId: uuid("state_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    yaoyaoId: uuid("yaoyao_id").notNull(),
    emotion: jsonb("emotion").notNull().$type<Record<string, unknown>>(),
    energy: numeric("energy", { precision: 5, scale: 4 }).notNull(),
    socialState: text("social_state").notNull(),
    relationshipState: text("relationship_state").notNull(),
    attention: text("attention").notNull(),
    internalState: jsonb("internal_state")
      .notNull()
      .$type<Record<string, unknown>>(),
    stateVersion: bigint("state_version", { mode: "number" }).notNull(),
    lastUpdated: tz("last_updated"),
  },
  (t) => [
    foreignKey({
      name: "core_states_owner_fk",
      columns: [t.userId, t.yaoyaoId],
      foreignColumns: [yaoyaos.userId, yaoyaos.yaoyaoId],
    }).onDelete("restrict"),
    uniqueIndex("core_states_yaoyao_uidx").on(t.yaoyaoId),
    uniqueIndex("core_states_owner_uidx").on(t.userId, t.yaoyaoId),
    check(
      "core_states_emotion_object",
      sql`jsonb_typeof(${t.emotion}) = 'object'`,
    ),
    check(
      "core_states_energy_01",
      sql`${t.energy} >= 0 AND ${t.energy} <= 1`,
    ),
    check(
      "core_states_relationship_state",
      sql`${t.relationshipState} IN ('calm','affectionate','hurt','conflicted','reconciled')`,
    ),
    check(
      "core_states_internal_object",
      sql`jsonb_typeof(${t.internalState}) = 'object'`,
    ),
    check("core_states_version_min", sql`${t.stateVersion} >= 1`),
    index("core_states_owner_version_idx").on(
      t.userId,
      t.yaoyaoId,
      t.stateVersion,
    ),
  ],
);
