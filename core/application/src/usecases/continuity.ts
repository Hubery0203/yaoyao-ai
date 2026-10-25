import {photoRequest} from '../photos.js';
import {isMemoryCommandText} from "../experience.js";
import {recordLifeStatement} from "./experience.js";
import {
  DomainEvent, Memory, MEMORY_POLICY, decideMemory, extractExplicitMemories, lexicalNovelty, normalizeMemoryText,
  type UserId, type EventId, type MemoryCandidate,
} from "@yaoyao/domain";
import type { ContinuityJob } from "../ports/continuity.js";
import type { CandidateAudit } from "../ports/continuity-processing.js";
import type { PersistenceTransaction, TransactionManager } from "../ports/persistence/transactions.js";

export class LostContinuityLeaseError extends Error { constructor(){super("Continuity lease expired or replaced");} }
export interface ContinuityResult { policy:string; memoriesCreated:number; held:number; duplicates:number; discarded:number; }
/** Fenced transaction: all side effects and completion commit or roll back together. */
export async function processContinuityJob(tx:PersistenceTransaction,userId:UserId,job:ContinuityJob,
  proposed?:readonly MemoryCandidate[]):Promise<ContinuityResult> {
  const store=tx.continuityProcessing;
  if(!await store.lockClaim(userId,job.jobId,job.leaseToken)) throw new LostContinuityLeaseError();
  await store.lockEntity(userId,job.yaoyaoId);
  const recorded=await store.readRun(userId,job.jobId);
  if(recorded) throw new Error("Job has already committed a run");
  const events=tx.events.readWindow?(await tx.events.readWindow(userId,job.yaoyaoId,{requestId:job.requestId,types:["USER_MESSAGE","ASSISTANT_MESSAGE"],limit:2})).events:await tx.events.readOwnedAfter(userId,job.yaoyaoId,0);
  const assistant=events.find(e=>String(e.event.eventId)===job.assistantEventId && e.event.type==="ASSISTANT_MESSAGE" && e.event.correlationId===job.requestId);
  const user=events.find(e=>e.event.type==="USER_MESSAGE" && e.event.correlationId===job.requestId);
  if(!assistant || !user || typeof user.event.payload.text!=="string") throw new Error("Incomplete continuity turn");
  const source=user.event.payload.text;
  if(photoRequest(source)===null)await recordLifeStatement(tx,userId,{text:source,occurredAt:user.event.occurredAt,sequence:user.aggregateSeq,timezone:typeof user.event.payload.timezone==="string"?user.event.payload.timezone:undefined});
  const muted=tx.experience?await tx.experience.mutedSlots(userId):{};
  const candidates=(isMemoryCommandText(source)||photoRequest(source)!==null)?[]:proposed??extractExplicitMemories(source);
  if(candidates.length>10) throw new Error("Too many candidates");
  const container=await tx.memoryContainers.findOwned(userId);
  const all=await tx.memories.listOwned(userId,{status:"CONSOLIDATED",limit:200});
  const result:ContinuityResult={policy:MEMORY_POLICY,memoriesCreated:0,held:0,duplicates:0,discarded:0};
  const accepted:string[]=[];
  for(let ordinal=0;ordinal<candidates.length;ordinal++) {
    const candidate=candidates[ordinal];
    const previous=await store.findSlot(userId,job.yaoyaoId,candidate.slot);
    const support=await store.supportCount(userId,job.yaoyaoId,candidate.slot,candidate.value);
    const inputs={importance:candidate.importance,relevance:candidate.relevance,confidence:candidate.confidence,
      novelty:lexicalNovelty(candidate.content,all.map(m=>m.content)),recurrence:Math.min(1,support/3)};
    let decision=decideMemory({candidate,source,inputs,previousValue:previous?.value,
      existingExact:!!previous && normalizeMemoryText(previous.value)===normalizeMemoryText(candidate.value)});
    if(Object.hasOwn(muted,candidate.slot))decision={...decision,outcome:"held",reason:"owner_disabled"};
    if(previous && decision.outcome==="consolidated" && (await tx.memories.findOwned(userId,previous.memoryId)).type==="CORE") {
      decision={...decision,outcome:"held",reason:"awaiting_core_confirmation"};
    }
    if(previous && previous.sourceSequence>user.aggregateSeq && decision.outcome==="consolidated") {
      decision={...decision,outcome:"held",reason:"older_than_current_memory"};
    }
    let memoryId=decision.outcome==="duplicate"?previous!.memoryId:null;
    if(decision.outcome==="consolidated") {
      const memoryContent="用户陈述："+candidate.content;
      const sources=[user.event.eventId as EventId];
      let memory:Memory;
      if(previous) {
        const old=await tx.memories.findOwned(userId,previous.memoryId);
        const correction=old.correct({content:memoryContent,importance:candidate.importance,confidence:candidate.confidence,sourceEvents:sources});
        await tx.memories.save(userId,correction.superseded);
        memory=correction.current;
      } else {
        memory=Memory.candidate({containerId:container.containerId,userId,yaoyaoId:job.yaoyaoId,
          type:candidate.type,content:memoryContent,importance:candidate.importance,confidence:candidate.confidence,sourceEvents:sources}).validate().consolidate();
      }
      await tx.memories.insert(memory);
      memoryId=memory.memoryId;
      await store.setSlot(userId,job.yaoyaoId,candidate.slot,candidate.value,memory.memoryId,user.aggregateSeq);
      await tx.events.append({event:DomainEvent.create({type:previous?"MEMORY_CORRECTED":"MEMORY_CONSOLIDATED",actor:"SYSTEM",source:"CORE",userId,yaoyaoId:job.yaoyaoId,
        causationId:user.event.eventId,correlationId:job.requestId,payload:{operation:previous?"supersede":"consolidate",
          memoryId:memory.memoryId,supersedes:previous?.memoryId??null,policy:MEMORY_POLICY}})});
      all.push(memory); accepted.push(memory.content); result.memoriesCreated++;
    } else if(decision.outcome==="held") result.held++;
    else if(decision.outcome==="duplicate") result.duplicates++;
    else result.discarded++;
    const audit:CandidateAudit={policy:MEMORY_POLICY,sourceEventId:String(user.event.eventId),candidate,inputs,...decision,memoryId};
    await store.recordCandidate(userId,job.yaoyaoId,job.jobId,ordinal,audit);
  }
  // Internal reflection is a bounded summary of grounded accepted memories;
  // it never asserts invented external events and never changes identity.
  if(accepted.length) {
    const state=await tx.states.findOwned(userId);
    const changes={internalState:{recentReflection:accepted.slice(0,3).join("；").slice(0,600)}};
    const next=state.transition(state.stateVersion,changes);
    const saved=await tx.states.saveStateIfVersionMatches(userId,state.stateVersion,next);
    if(saved.outcome==="stale") throw new Error("State changed during continuity processing");
    await tx.events.append({event:DomainEvent.create({type:"STATE_CHANGED",actor:"SYSTEM",source:"CORE",userId,yaoyaoId:job.yaoyaoId,
      causationId:assistant.event.eventId,correlationId:job.requestId,
      payload:{changes,expectedVersion:state.stateVersion,newVersion:next.stateVersion,policy:MEMORY_POLICY}})});
  }
  await store.recordRun(userId,job.yaoyaoId,job.jobId,{...result});
  if(!await tx.continuity.complete(userId,job.jobId,job.leaseToken)) throw new LostContinuityLeaseError();
  return result;
}

/** One bounded owner pass. DB is authoritative; no effects happen outside the fenced transaction. */
export async function runContinuityOnce(manager:TransactionManager,userId:UserId):Promise<"idle"|"completed"|"retry"> {
  await manager.runAsUser(userId,tx=>tx.continuity.sweepExpiredLeases(userId));
  const job=await manager.runAsUser(userId,tx=>tx.continuity.claimNext(userId,60));
  if(!job) return "idle";
  try {
    await manager.runAsUser(userId,tx=>processContinuityJob(tx,userId,job));
    return "completed";
  } catch {
    await manager.runAsUser(userId,tx=>tx.continuityProcessing.fail(userId,job.jobId,job.leaseToken));
    return "retry";
  }
}
