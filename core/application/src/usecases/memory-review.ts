import { DomainEvent, Memory, MEMORY_POLICY, scoreMemory, validateMemoryCandidate, type UserId } from "@yaoyao/domain";
import { DomainValidationError } from "@yaoyao/domain";
import { EntityNotFoundError } from "../ports/persistence/errors.js";
import type { PersistenceTransaction } from "../ports/persistence/transactions.js";
export async function resolveMemoryCandidate(tx:PersistenceTransaction,userId:UserId,jobId:string,ordinal:number,
  decision:"confirm"|"discard"):Promise<Record<string,unknown>> {
  const store=tx.continuityProcessing;
  let row=await store.readAudit(userId,jobId,ordinal);
  if(!row) throw new EntityNotFoundError("MemoryCandidate");
  await store.lockEntity(userId,row.yaoyaoId);
  row=await store.readAudit(userId,jobId,ordinal);
  if(!row) throw new EntityNotFoundError("MemoryCandidate");
  if(row.resolution) {
    if(row.resolution.decision!==decision) throw new DomainValidationError("Candidate was already resolved differently");
    return row.resolution;
  }
  if(row.audit.outcome!=="held") throw new DomainValidationError("Only held candidates can be resolved");
  const result:Record<string,unknown>={decision,memoryId:null};
  if(decision==="confirm") {
    const candidate=row.audit.candidate;
    const events=await tx.events.readOwnedAfter(userId,row.yaoyaoId,0);
    const user=events.find(e=>String(e.event.eventId)===row!.audit.sourceEventId && e.event.type==="USER_MESSAGE" &&
      typeof e.event.payload.text==="string" && validateMemoryCandidate(candidate,e.event.payload.text));
    if(!user) throw new DomainValidationError("Candidate evidence is unavailable");
    const container=await tx.memoryContainers.findOwned(userId);
    const previous=await store.findSlot(userId,row.yaoyaoId,candidate.slot);
    let memory:Memory;
    if(previous) {
      const old=await tx.memories.findOwned(userId,previous.memoryId);
      const correction=old.correct({type:candidate.type,content:"用户陈述："+candidate.content,confidence:1,importance:candidate.importance,sourceEvents:[user.event.eventId]});
      memory=correction.current;
      await tx.memories.save(userId,correction.superseded);
    } else {
      memory=Memory.candidate({containerId:container.containerId,userId,yaoyaoId:row.yaoyaoId,type:candidate.type,
        content:"用户陈述："+candidate.content,confidence:1,importance:candidate.importance,sourceEvents:[user.event.eventId]}).validate().consolidate();
    }
    await tx.memories.insert(memory);
    const confirmation=await tx.events.append({event:DomainEvent.create({type:previous?"MEMORY_CORRECTED":"MEMORY_CONSOLIDATED",actor:"USER",source:"CORE",
      userId,yaoyaoId:row.yaoyaoId,causationId:user.event.eventId,correlationId:jobId,
      payload:{memoryId:memory.memoryId,supersedes:previous?.memoryId??null,operation:"owner_confirmed"}})});
    await store.setSlot(userId,row.yaoyaoId,candidate.slot,candidate.value,memory.memoryId,confirmation.aggregateSeq);
    result.memoryId=memory.memoryId;
  }
  await store.recordResolution(userId,row.yaoyaoId,jobId,ordinal,result);
  return result;
}

/** Historical scoring replay reads recorded inputs only and never mutates state. */
export async function replayMemoryEvaluation(tx:PersistenceTransaction,userId:UserId,jobId:string,ordinal:number):Promise<Record<string,unknown>> {
  const row=await tx.continuityProcessing.readAudit(userId,jobId,ordinal);
  if(!row) throw new EntityNotFoundError("MemoryCandidate");
  if(row.audit.policy!==MEMORY_POLICY) throw new DomainValidationError("Unsupported memory policy version");
  if(row.audit.reason==="invalid_or_ungrounded") return {policy:row.audit.policy,outcome:"not_scored",reason:row.audit.reason};
  const score=scoreMemory(row.audit.inputs);
  return {policy:row.audit.policy,recordedScore:row.audit.score,recomputedScore:score,matches:score===row.audit.score};
}
