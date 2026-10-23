import { DomainEvent, evolveEmotion, EMOTION_EVOLUTION_POLICY, EMOTION_DIMENSIONS, type UserId } from "@yaoyao/domain";
import type { PersistenceTransaction } from "../ports/persistence/transactions.js";
/** Explicit command; the context and historical replay ports remain read-only. */
export async function advanceTemporalEmotion(tx:PersistenceTransaction,userId:UserId,requestId:string,now=new Date()):Promise<boolean> {
  const aggregate=await tx.aggregates.loadOwned(userId);
  const yaoyaoId=aggregate.yaoyaoId;
  await tx.continuityProcessing.lockEntity(userId,yaoyaoId);
  const current=await tx.states.findOwned(userId);
  const events=tx.events.readWindow?(await tx.events.readWindow(userId,yaoyaoId,{emotionOnly:true,limit:1})).events:await tx.events.readOwnedAfter(userId,yaoyaoId,0);
  const emotionEvents=events.filter(({event})=>event.type==="STATE_CREATED" ||
    (event.type==="STATE_CHANGED" && typeof event.payload.changes==="object" && event.payload.changes!==null && "emotion" in event.payload.changes));
  const anchor=emotionEvents.at(-1)?.event.occurredAt??current.lastUpdated;
  const elapsed=now.getTime()-anchor.getTime();
  if (!Number.isFinite(elapsed) || elapsed<60000) return false;
  const duplicate=tx.events.readWindow?(await tx.events.readWindow(userId,yaoyaoId,{types:["STATE_CHANGED"],requestId,policy:EMOTION_EVOLUTION_POLICY,limit:1})).events.length>0:events.some(({event})=>event.type==="STATE_CHANGED" && event.correlationId===requestId && event.payload.policy===EMOTION_EVOLUTION_POLICY);
  if(duplicate) return false;
  const values=evolveEmotion(current.emotion.values,elapsed);
  if (!EMOTION_DIMENSIONS.some(dim=>values[dim]!==current.emotion.get(dim))) return false;
  const next=current.transition(current.stateVersion,{emotion:values});
  const saved=await tx.states.saveStateIfVersionMatches(userId,current.stateVersion,next);
  if(saved.outcome==="stale") return false;
  await tx.events.append({event:DomainEvent.create({type:"STATE_CHANGED",actor:"SYSTEM",source:"CORE",userId,yaoyaoId,
    correlationId:requestId,occurredAt:now,payload:{policy:EMOTION_EVOLUTION_POLICY,elapsedMs:elapsed,
      changes:{emotion:values},expectedVersion:current.stateVersion,newVersion:next.stateVersion}})});
  return true;
}
