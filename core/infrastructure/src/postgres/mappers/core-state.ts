/**
 * CoreState mapper — guarded hydration via CoreState.reconstitute().
 *
 * The emotion JSONB passes through as a plain object; EmotionVector.create
 * (inside reconstitute) enforces the nine dimensions and [0,1] bounds.
 * energy arrives as numeric-as-string and is parsed with a finite check.
 */
import {
  CoreState,
  type EmotionValues,
  type InternalState,
  type OperationalRelationshipState,
  type StateId,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { coreStates } from "../schema/index.js";
import {
  asDate,
  asRecord,
  branded,
  hydrate,
  numericToNumber,
} from "./primitives.js";

export type CoreStateRow = typeof coreStates.$inferSelect;
export type CoreStateInsert = typeof coreStates.$inferInsert;

const TABLE = "core_states";

export function toCoreStateRow(state: CoreState): CoreStateInsert {
  return {
    stateId: state.stateId as string,
    userId: state.userId as string,
    yaoyaoId: state.yaoyaoId as string,
    emotion: { ...state.emotion.values },
    energy: String(state.energy),
    socialState: state.socialState,
    relationshipState: state.relationshipState,
    attention: state.attention,
    internalState: { ...state.internalState },
    stateVersion: state.stateVersion,
    lastUpdated: state.lastUpdated,
  };
}

export function fromCoreStateRow(row: CoreStateRow): CoreState {
  return hydrate(TABLE, row.stateId, () =>
    CoreState.reconstitute({
      stateId: branded<StateId>(row.stateId, "state_id", TABLE),
      userId: branded<UserId>(row.userId, "user_id", TABLE),
      yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", TABLE),
      emotion: asRecord(row.emotion, "emotion", TABLE) as EmotionValues,
      energy: numericToNumber(row.energy, "energy", TABLE),
      socialState: row.socialState,
      relationshipState: row.relationshipState as OperationalRelationshipState,
      attention: row.attention,
      internalState: asRecord(row.internalState, "internal_state", TABLE) as InternalState,
      stateVersion: row.stateVersion,
      lastUpdated: asDate(row.lastUpdated, "last_updated", TABLE),
    }),
  );
}
