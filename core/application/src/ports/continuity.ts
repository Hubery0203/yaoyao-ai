/** Reconstructed MVP-003A: durable jobs, scoped to the authenticated owner.
 * Every call runs in the caller's transaction. No LLM/memory processing here.
 * A lease token fences stale workers after a job is reclaimed.
 */
import type { UserId, YaoYaoId } from "@yaoyao/domain";
export interface ContinuityJob {
  jobId: string;
  requestId: string;
  assistantEventId: string;
  attempts: number;
  leaseToken: string;
  leaseExpiresAt: Date;
}
export interface ContinuityJobStore {
  lockTurn(userId: UserId, yaoyaoId: YaoYaoId, requestId: string): Promise<void>;
  enqueue(input: { userId: UserId; yaoyaoId: YaoYaoId; requestId: string; assistantEventId: string }): Promise<void>;
  claimNext(userId: UserId, leaseSeconds: number): Promise<ContinuityJob | null>;
  complete(userId: UserId, jobId: string, leaseToken: string): Promise<boolean>;
  sweepExpiredLeases(userId: UserId): Promise<number>;
}
