/**
 * PostgresRelationshipRepository + PostgresCoreStateRepository.
 *
 * Relationship: metrics-only writes. There is deliberately no code path
 * that writes type/status/termination_allowed — the SET clause lists
 * metric columns explicitly, so a hard-field write is unrepresentable.
 *
 * CoreState: optimistic compare-and-swap. The UPDATE predicates on the
 * expected version; zero affected rows means the write lost a race and
 * the caller receives the live version to reload and recompute.
 */
import {
  EntityNotFoundError,
  PersistenceConflictError,
  type CoreStateRepository,
  type RelationshipRepository,
  type SaveStateResult,
} from "@yaoyao/application";
import {
  CoreState,
  Relationship,
  type UserId,
} from "@yaoyao/domain";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { mapPgError } from "../errors.js";
import {
  fromCoreStateRow,
  fromRelationshipRow,
  toCoreStateRow,
} from "../mappers/index.js";
import { coreStates, relationships } from "../schema/index.js";

export class PostgresRelationshipRepository implements RelationshipRepository {
  constructor(private readonly db: Db) {}

  async findOwned(userId: UserId): Promise<Relationship> {
    const rows = await this.db
      .select()
      .from(relationships)
      .where(eq(relationships.userId, userId as string))
      .limit(1);
    if (rows.length === 0) throw new EntityNotFoundError("Relationship");
    return fromRelationshipRow(rows[0]);
  }

  async saveMetrics(
    userId: UserId,
    relationship: Relationship,
  ): Promise<Relationship> {
    const m = relationship.metrics;
    const uid = userId as string;
    const rows = await this.db
      .update(relationships)
      .set({
        // Metrics only — type/status/termination_allowed have no write path.
        intimacy: String(m.intimacy),
        trust: String(m.trust),
        familiarity: String(m.familiarity),
        affection: String(m.affection),
        hurt: String(m.hurt),
        conflict: String(m.conflict),
        updatedAt: relationship.updatedAt,
      })
      .where(
        and(
          eq(relationships.userId, uid),
          eq(relationships.yaoyaoId, relationship.yaoyaoId as string),
        ),
      )
      .returning();
    if (rows.length === 0) throw new EntityNotFoundError("Relationship");
    return fromRelationshipRow(rows[0]);
  }
}

export class PostgresCoreStateRepository implements CoreStateRepository {
  constructor(private readonly db: Db) {}

  async findOwned(userId: UserId): Promise<CoreState> {
    const rows = await this.db
      .select()
      .from(coreStates)
      .where(eq(coreStates.userId, userId as string))
      .limit(1);
    if (rows.length === 0) throw new EntityNotFoundError("CoreState");
    return fromCoreStateRow(rows[0]);
  }

  async insert(state: CoreState): Promise<void> {
    try {
      await this.db.insert(coreStates).values(toCoreStateRow(state));
    } catch (e) {
      throw mapPgError(e, "CoreState");
    }
  }

  async saveStateIfVersionMatches(
    userId: UserId,
    expectedVersion: number,
    next: CoreState,
  ): Promise<SaveStateResult> {
    // Defensive caller check: the domain transition() already guarantees
    // version+1, but the repository refuses to persist an incoherent jump.
    if (next.stateVersion !== expectedVersion + 1) {
      throw new PersistenceConflictError(
        `refusing to persist state version ${next.stateVersion} over expected ${expectedVersion}`,
      );
    }
    const uid = userId as string;
    const yid = next.yaoyaoId as string;
    const row = toCoreStateRow(next);
    const updated = await this.db
      .update(coreStates)
      .set({
        emotion: row.emotion,
        energy: row.energy,
        socialState: row.socialState,
        relationshipState: row.relationshipState,
        attention: row.attention,
        internalState: row.internalState,
        stateVersion: row.stateVersion,
        lastUpdated: row.lastUpdated,
      })
      .where(
        and(
          eq(coreStates.userId, uid),
          eq(coreStates.yaoyaoId, yid),
          eq(coreStates.stateVersion, expectedVersion),
        ),
      )
      .returning();
    if (updated.length === 1) {
      return { outcome: "saved", state: fromCoreStateRow(updated[0]) };
    }
    // Zero rows: either the state is gone or someone else won the race.
    const [current] = await this.db
      .select({ stateVersion: coreStates.stateVersion })
      .from(coreStates)
      .where(and(eq(coreStates.userId, uid), eq(coreStates.yaoyaoId, yid)))
      .limit(1);
    if (!current) throw new EntityNotFoundError("CoreState");
    return {
      outcome: "stale",
      expected: expectedVersion,
      current: current.stateVersion,
    };
  }
}
