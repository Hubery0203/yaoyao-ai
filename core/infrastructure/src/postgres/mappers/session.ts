/**
 * Session mapper — guarded hydration via Session.reconstitute().
 */
import {
  Session,
  type SessionId,
  type SessionStatus,
  type UserId,
  type YaoYaoId,
} from "@yaoyao/domain";
import { sessions } from "../schema/index.js";
import {
  asDate,
  asNullableDate,
  branded,
  hydrate,
} from "./primitives.js";

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;

const TABLE = "sessions";

export function toSessionRow(session: Session): SessionInsert {
  return {
    sessionId: session.sessionId as string,
    userId: session.userId as string,
    yaoyaoId: session.yaoyaoId as string,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    clientInstanceId: session.clientInstanceId,
  };
}

export function fromSessionRow(row: SessionRow): Session {
  return hydrate(TABLE, row.sessionId, () =>
    Session.reconstitute({
      sessionId: branded<SessionId>(row.sessionId, "session_id", TABLE),
      userId: branded<UserId>(row.userId, "user_id", TABLE),
      yaoyaoId: branded<YaoYaoId>(row.yaoyaoId, "yaoyao_id", TABLE),
      startedAt: asDate(row.startedAt, "started_at", TABLE),
      endedAt: asNullableDate(row.endedAt, "ended_at", TABLE),
      status: row.status as SessionStatus,
      clientInstanceId: row.clientInstanceId,
    }),
  );
}
