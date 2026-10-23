import type { UserId, YaoYaoId, MemoryId, MemoryCandidate, MemoryScoreInputs, CandidateOutcome } from "@yaoyao/domain";
export interface CandidateAudit {
  policy:string;
  sourceEventId:string;
  candidate: MemoryCandidate; inputs: MemoryScoreInputs; score: number;
  outcome: CandidateOutcome; reason: string; memoryId: MemoryId | null;
}
export interface ContinuityProcessingStore {
  lockEntity(userId: UserId, yaoyaoId: YaoYaoId): Promise<void>;
  lockClaim(userId: UserId, jobId: string, token: string): Promise<boolean>;
  readRun(userId: UserId, jobId: string): Promise<Record<string,unknown> | null>;
  recordRun(userId: UserId, yaoyaoId: YaoYaoId, jobId: string, result: Record<string,unknown>): Promise<void>;
  findSlot(userId: UserId, yaoyaoId: YaoYaoId, slot: string): Promise<{value:string;memoryId:MemoryId;sourceSequence:number} | null>;
  setSlot(userId: UserId, yaoyaoId: YaoYaoId, slot: string, value: string, memoryId: MemoryId, sourceSequence:number): Promise<void>;
  supportCount(userId: UserId, yaoyaoId: YaoYaoId, slot: string, value: string): Promise<number>;
  recordCandidate(userId: UserId, yaoyaoId: YaoYaoId, jobId: string, ordinal: number, audit: CandidateAudit): Promise<void>;
  readAudit(userId:UserId,jobId:string,ordinal:number):Promise<{yaoyaoId:YaoYaoId;audit:CandidateAudit;resolution:Record<string,unknown>|null}|null>;
  recordResolution(userId:UserId,yaoyaoId:YaoYaoId,jobId:string,ordinal:number,result:Record<string,unknown>):Promise<void>;
  listAudits(userId: UserId, limit: number): Promise<Record<string,unknown>[]>;
  listJobs(userId: UserId, limit: number): Promise<Record<string,unknown>[]>;
  requeue(userId: UserId, jobId: string): Promise<boolean>;
  fail(userId: UserId, jobId: string, token: string): Promise<boolean>;
}
