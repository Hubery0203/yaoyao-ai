import type { ContinuityJob, ContinuityJobStore } from "@yaoyao/application";
import { uuidv7, type UserId, type YaoYaoId } from "@yaoyao/domain";
import { sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { advisoryLockKey64 } from "../locks.js";

export class PostgresContinuityJobStore implements ContinuityJobStore {
  constructor(private readonly db: Db) {}

  async lockTurn(userId: UserId, yaoyaoId: YaoYaoId, requestId: string): Promise<void> {
    if (!requestId) throw new Error("requestId must be non-empty");
    const key = advisoryLockKey64("yaoyao.ai/turn/v1", JSON.stringify([userId, yaoyaoId, requestId]));
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(${key}::bigint)`);
  }

  async enqueue(input: { userId: UserId; yaoyaoId: YaoYaoId; requestId: string; assistantEventId: string }): Promise<void> {
    const result = await this.db.execute(sql`
      INSERT INTO continuity_jobs(job_id,user_id,yaoyao_id,request_id,assistant_event_id)
      SELECT ${uuidv7()}::uuid, e.user_id, e.yaoyao_id, ${input.requestId}, e.event_id
      FROM events e WHERE e.event_id = ${input.assistantEventId}::uuid
        AND e.user_id = ${input.userId}::uuid AND e.yaoyao_id = ${input.yaoyaoId}::uuid
        AND e.type = 'ASSISTANT_MESSAGE' AND e.correlation_id = ${input.requestId}
        AND EXISTS (SELECT 1 FROM events u WHERE u.user_id=e.user_id AND u.yaoyao_id=e.yaoyao_id
          AND u.type='USER_MESSAGE' AND u.correlation_id=e.correlation_id)
      ON CONFLICT(user_id,yaoyao_id,request_id) DO UPDATE
        SET request_id = EXCLUDED.request_id
        WHERE continuity_jobs.assistant_event_id = EXCLUDED.assistant_event_id
      RETURNING job_id`);
    if (result.rows.length !== 1) throw new Error("Continuity job requires a matching completed turn");
  }

  async claimNext(userId: UserId, leaseSeconds: number): Promise<ContinuityJob | null> {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      throw new Error("leaseSeconds must be an integer in [1,3600]");
    }
    const result = await this.db.execute(sql`
      WITH candidate AS (
        SELECT job_id FROM continuity_jobs WHERE user_id=${userId}::uuid AND status='pending' AND attempts<5 AND available_at<=clock_timestamp()
        ORDER BY created_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE continuity_jobs j SET status='claimed', attempts=attempts+1,
        lease_token=${uuidv7()}::uuid, lease_expires_at=clock_timestamp()+${leaseSeconds}*interval '1 second'
      FROM candidate c WHERE j.job_id=c.job_id
      RETURNING j.job_id,j.yaoyao_id,j.request_id,j.assistant_event_id,j.attempts,j.lease_token,j.lease_expires_at`);
    const row = result.rows[0];
    return row ? {
      jobId: String(row.job_id), yaoyaoId: String(row.yaoyao_id) as YaoYaoId, requestId: String(row.request_id),
      assistantEventId: String(row.assistant_event_id), attempts: Number(row.attempts),
      leaseToken: String(row.lease_token), leaseExpiresAt: new Date(String(row.lease_expires_at)),
    } : null;
  }

  async complete(userId: UserId, jobId: string, leaseToken: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE continuity_jobs SET status='completed', completed_at=clock_timestamp(),
        lease_token=NULL,lease_expires_at=NULL
      WHERE user_id=${userId}::uuid AND job_id=${jobId}::uuid AND status='claimed'
        AND lease_token=${leaseToken}::uuid AND lease_expires_at>clock_timestamp()
      RETURNING job_id`);
    return result.rows.length === 1;
  }

  async sweepExpiredLeases(userId: UserId): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE continuity_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
        available_at=clock_timestamp()+LEAST(300,POWER(2,LEAST(attempts,8))) * interval '1 second',
        lease_token=NULL,lease_expires_at=NULL
      WHERE user_id=${userId}::uuid AND status='claimed' AND lease_expires_at<=clock_timestamp()
      RETURNING job_id`);
    return result.rows.length;
  }
}
