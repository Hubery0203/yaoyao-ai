/**
 * YaoYao + Relationship mappers — guarded hydration.
 *
 * Relationship.reconstitute() re-validates the hard invariants
 * (deep_partner / active / termination_allowed=false): a defective row
 * is rejected, never repaired.
 */
import {
  Relationship,
  YaoYao,
  type RelationshipId,
  type UserId,
  type YaoYaoId,
  type YaoYaoStatus,
} from "@yaoyao/domain";
import { relationships, yaoyaos } from "../schema/index.js";
import {
  asDate,
  branded,
  hydrate,
  numericToNumber,
} from "./primitives.js";

export type YaoYaoRow = typeof yaoyaos.$inferSelect;
export type YaoYaoInsert = typeof yaoyaos.$inferInsert;
export type RelationshipRow = typeof relationships.$inferSelect;
export type RelationshipInsert = typeof relationships.$inferInsert;

const YAOYAO_TABLE = "yaoyaos";
const REL_TABLE = "relationships";

export function toYaoYaoRow(yaoyao: YaoYao): YaoYaoInsert {
  return {
    yaoyaoId: yaoyao.yaoyaoId as string,
    userId: yaoyao.userId as string,
    identityKey: yaoyao.identityKey,
    identityVersion: yaoyao.identityVersion,
    status: yaoyao.status,
    createdAt: yaoyao.createdAt,
    updatedAt: yaoyao.updatedAt,
  };
}

export function fromYaoYaoRow(row: YaoYaoRow): YaoYao {
  return hydrate(YAOYAO_TABLE, row.yaoyaoId, () =>
    YaoYao.reconstitute({
      yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", YAOYAO_TABLE),
      userId: branded<UserId>(row.userId, "user_id", YAOYAO_TABLE),
      identityKey: row.identityKey,
      identityVersion: row.identityVersion,
      status: row.status as YaoYaoStatus,
      createdAt: asDate(row.createdAt, "created_at", YAOYAO_TABLE),
      updatedAt: asDate(row.updatedAt, "updated_at", YAOYAO_TABLE),
    }),
  );
}

export function toRelationshipRow(relationship: Relationship): RelationshipInsert {
  const m = relationship.metrics;
  return {
    relationshipId: relationship.relationshipId as string,
    userId: relationship.userId as string,
    yaoyaoId: relationship.yaoyaoId as string,
    type: relationship.type,
    status: relationship.status,
    terminationAllowed: relationship.terminationAllowed,
    intimacy: String(m.intimacy),
    trust: String(m.trust),
    familiarity: String(m.familiarity),
    affection: String(m.affection),
    hurt: String(m.hurt),
    conflict: String(m.conflict),
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
  };
}

export function fromRelationshipRow(row: RelationshipRow): Relationship {
  return hydrate(REL_TABLE, row.relationshipId, () =>
    Relationship.reconstitute({
      relationshipId: branded<RelationshipId>(
        row.relationshipId,
        "relationship_id",
        REL_TABLE,
      ),
      userId: branded<UserId>(row.userId, "user_id", REL_TABLE),
      yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", REL_TABLE),
      type: row.type,
      status: row.status,
      terminationAllowed: row.terminationAllowed,
      metrics: {
        intimacy: numericToNumber(row.intimacy, "intimacy", REL_TABLE),
        trust: numericToNumber(row.trust, "trust", REL_TABLE),
        familiarity: numericToNumber(row.familiarity, "familiarity", REL_TABLE),
        affection: numericToNumber(row.affection, "affection", REL_TABLE),
        hurt: numericToNumber(row.hurt, "hurt", REL_TABLE),
        conflict: numericToNumber(row.conflict, "conflict", REL_TABLE),
      },
      createdAt: asDate(row.createdAt, "created_at", REL_TABLE),
      updatedAt: asDate(row.updatedAt, "updated_at", REL_TABLE),
    }),
  );
}
