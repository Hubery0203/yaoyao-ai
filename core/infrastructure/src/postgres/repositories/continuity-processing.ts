import type { CandidateAudit, ContinuityProcessingStore } from "@yaoyao/application";
import type { UserId, YaoYaoId, MemoryId } from "@yaoyao/domain";
import { sql } from "drizzle-orm";
import type { Db } from "../db.js";
import { advisoryLockKey64 } from "../locks.js";
export class PostgresContinuityProcessingStore implements ContinuityProcessingStore {
  constructor(private readonly db: Db) {}
  async lockEntity(userId:UserId,yaoyaoId:YaoYaoId):Promise<void> {
    const key=advisoryLockKey64("yaoyao.ai/continuity-entity/v1",JSON.stringify([userId,yaoyaoId]));
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(${key}::bigint)`);
  }
  async lockClaim(userId:UserId,jobId:string,token:string):Promise<boolean> {
    const r=await this.db.execute(sql`SELECT job_id FROM continuity_jobs WHERE user_id=${userId}::uuid
      AND job_id=${jobId}::uuid AND lease_token=${token}::uuid AND status='claimed'
      AND lease_expires_at>clock_timestamp() FOR UPDATE`);
    return r.rows.length===1;
  }
  async readRun(userId:UserId,jobId:string):Promise<Record<string,unknown>|null> {
    const r=await this.db.execute(sql`SELECT result FROM continuity_runs WHERE user_id=${userId}::uuid AND job_id=${jobId}::uuid`);
    return r.rows.length ? r.rows[0].result as Record<string,unknown> : null;
  }
  async recordRun(userId:UserId,yaoyaoId:YaoYaoId,jobId:string,result:Record<string,unknown>):Promise<void> {
    await this.db.execute(sql`INSERT INTO continuity_runs(job_id,user_id,yaoyao_id,result)
      VALUES(${jobId}::uuid,${userId}::uuid,${yaoyaoId}::uuid,${JSON.stringify(result)}::jsonb)`);
  }
  async findSlot(userId:UserId,yaoyaoId:YaoYaoId,slot:string):Promise<{value:string;memoryId:MemoryId;sourceSequence:number}|null> {
    const r=await this.db.execute(sql`SELECT s.value,s.memory_id,s.source_sequence FROM memory_slots s JOIN memories m ON m.memory_id=s.memory_id
      WHERE s.user_id=${userId}::uuid AND s.yaoyao_id=${yaoyaoId}::uuid AND s.slot=${slot} AND m.status='CONSOLIDATED'`);
    return r.rows.length ? {value:String(r.rows[0].value),memoryId:String(r.rows[0].memory_id) as MemoryId,sourceSequence:Number(r.rows[0].source_sequence)}:null;
  }
  async setSlot(userId:UserId,yaoyaoId:YaoYaoId,slot:string,value:string,memoryId:MemoryId,sourceSequence:number):Promise<void> {
    await this.db.execute(sql`INSERT INTO memory_slots(user_id,yaoyao_id,slot,value,memory_id,source_sequence)
      VALUES(${userId}::uuid,${yaoyaoId}::uuid,${slot},${value},${memoryId}::uuid,${sourceSequence})
      ON CONFLICT(user_id,yaoyao_id,slot) DO UPDATE SET value=EXCLUDED.value,memory_id=EXCLUDED.memory_id,source_sequence=EXCLUDED.source_sequence`);
  }
  async supportCount(userId:UserId,yaoyaoId:YaoYaoId,slot:string,value:string):Promise<number> {
    const r=await this.db.execute(sql`SELECT count(DISTINCT job_id)::int AS count FROM memory_candidate_audits
      WHERE user_id=${userId}::uuid AND yaoyao_id=${yaoyaoId}::uuid
      AND audit->'candidate'->>'slot'=${slot} AND audit->'candidate'->>'value'=${value}
      AND audit->>'outcome' IN ('consolidated','duplicate')`);
    return Number(r.rows[0].count);
  }
  async recordCandidate(userId:UserId,yaoyaoId:YaoYaoId,jobId:string,ordinal:number,audit:CandidateAudit):Promise<void> {
    await this.db.execute(sql`INSERT INTO memory_candidate_audits(job_id,ordinal,user_id,yaoyao_id,audit)
      VALUES(${jobId}::uuid,${ordinal},${userId}::uuid,${yaoyaoId}::uuid,${JSON.stringify(audit)}::jsonb)`);
  }
  async readAudit(userId:UserId,jobId:string,ordinal:number):Promise<{yaoyaoId:YaoYaoId;audit:CandidateAudit;resolution:Record<string,unknown>|null}|null> {
    const r=await this.db.execute(sql`SELECT a.yaoyao_id,a.audit,r.result FROM memory_candidate_audits a
      LEFT JOIN memory_candidate_resolutions r ON r.job_id=a.job_id AND r.ordinal=a.ordinal
      WHERE a.user_id=${userId}::uuid AND a.job_id=${jobId}::uuid AND a.ordinal=${ordinal}`);
    return r.rows.length?{yaoyaoId:String(r.rows[0].yaoyao_id) as YaoYaoId,audit:r.rows[0].audit as CandidateAudit,
      resolution:r.rows[0].result as Record<string,unknown>|null}:null;
  }
  async recordResolution(userId:UserId,yaoyaoId:YaoYaoId,jobId:string,ordinal:number,result:Record<string,unknown>):Promise<void> {
    await this.db.execute(sql`INSERT INTO memory_candidate_resolutions(user_id,yaoyao_id,job_id,ordinal,result)
      VALUES(${userId}::uuid,${yaoyaoId}::uuid,${jobId}::uuid,${ordinal},${JSON.stringify(result)}::jsonb)`);
  }
  async listAudits(userId:UserId,limit:number):Promise<Record<string,unknown>[]> {
    const r=await this.db.execute(sql`SELECT a.job_id,a.ordinal,a.audit,a.created_at,r.result AS resolution FROM memory_candidate_audits a
      LEFT JOIN memory_candidate_resolutions r ON r.job_id=a.job_id AND r.ordinal=a.ordinal
      WHERE a.user_id=${userId}::uuid ORDER BY a.created_at DESC,a.job_id,a.ordinal LIMIT ${Math.min(100,Math.max(1,limit))}`);
    return r.rows;
  }
  async listJobs(userId:UserId,limit:number):Promise<Record<string,unknown>[]> {
    const r=await this.db.execute(sql`SELECT job_id,status,attempts,available_at,lease_expires_at,last_error,created_at,completed_at
      FROM continuity_jobs WHERE user_id=${userId}::uuid ORDER BY created_at DESC,job_id LIMIT ${Math.min(100,Math.max(1,limit))}`);
    return r.rows;
  }
  async requeue(userId:UserId,jobId:string):Promise<boolean> {
    const r=await this.db.execute(sql`UPDATE continuity_jobs SET status='pending',attempts=0,last_error=NULL,available_at=clock_timestamp()
      WHERE user_id=${userId}::uuid AND job_id=${jobId}::uuid AND status='failed' RETURNING job_id`);
    return r.rows.length===1;
  }
  async fail(userId:UserId,jobId:string,token:string):Promise<boolean> {
    const r=await this.db.execute(sql`UPDATE continuity_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
      lease_token=NULL,lease_expires_at=NULL,last_error='processing_failed',
      available_at=clock_timestamp()+LEAST(300,POWER(2,LEAST(attempts,8)))*interval '1 second'
      WHERE user_id=${userId}::uuid AND job_id=${jobId}::uuid AND lease_token=${token}::uuid AND status='claimed'
      AND lease_expires_at>clock_timestamp() RETURNING job_id`);
    return r.rows.length===1;
  }
}
