import { DomainEvent, DomainValidationError, extractExplicitMemories, newEventId,
  type Memory, type MemoryId, type UserId } from "@yaoyao/domain";
import { IdempotencyKeyReusedError, PersistenceConflictError, StaleWriteError } from "../ports/persistence/errors.js";
import type { PersistenceTransaction } from "../ports/persistence/transactions.js";

/** A bounded, owner-scoped detail read. Never serialize raw events or audit inputs. */
export async function readMemoryDetail(tx:PersistenceTransaction,userId:UserId,memoryId:MemoryId) {
  const memory=await tx.memories.findOwned(userId,memoryId);
  const history:Memory[]=[];let cursor=memory;const seen=new Set<string>([String(memoryId)]);
  while(cursor.supersedes&&history.length<20) {
    if(seen.has(String(cursor.supersedes)))break;
    seen.add(String(cursor.supersedes));cursor=await tx.memories.findOwned(userId,cursor.supersedes);history.push(cursor);
  }
  const sources=[];
  for(const id of memory.sourceEvents.slice(0,10)) {
    const rows=tx.events.readWindow?(await tx.events.readWindow(userId,memory.yaoyaoId,{eventId:String(id),limit:1})).events:
      (await tx.events.readOwnedAfter(userId,memory.yaoyaoId,0)).filter(r=>r.event.eventId===id);
    const row=rows.find(r=>r.event.eventId===id);
    if(!row)continue;
    const e=row.event;
    const text=e.type==="USER_MESSAGE"?e.payload.text:
      e.type==="MEMORY_CORRECTED"&&e.actor==="USER"&&["owner_corrected","owner_recorded"].includes(String(e.payload.operation))?e.payload.statement:undefined;
    if(typeof text==="string")sources.push({text,occurredAt:e.occurredAt.toISOString(),kind:e.type==="USER_MESSAGE"?"conversation":"owner_correction"});
  }
  const slot=await tx.continuityProcessing.findSlotByMemory?.(userId,memory.yaoyaoId,memory.memoryId);
  return {memory,history,sources,historyTruncated:!!cursor.supersedes,sourcesTruncated:memory.sourceEvents.length>10,
    canCorrect:memory.status==="CONSOLIDATED"&&memory.type==="SEMANTIC"&&!!slot&&/^user:(?:location|name|preference:.+)$/u.test(slot.slot)};
}

/** Explicit correction of the SAME canonical slot. All writes share one transaction. */
export async function correctOwnedMemory(tx:PersistenceTransaction,input:{userId:UserId;memoryId:MemoryId;
  expectedVersion:number;text:string;requestId:string}):Promise<{memoryId:string}> {
  let old=await tx.memories.findOwned(input.userId,input.memoryId);
  await tx.continuityProcessing.lockEntity(input.userId,old.yaoyaoId);
  const correlationId="memory-edit:"+input.requestId;
  const rows=tx.events.readWindow?(await tx.events.readWindow(input.userId,old.yaoyaoId,{requestId:correlationId,types:["MEMORY_CORRECTED"],limit:1})).events:
    (await tx.events.readOwnedAfter(input.userId,old.yaoyaoId,0)).filter(r=>r.event.correlationId===correlationId&&r.event.type==="MEMORY_CORRECTED");
  const previous=rows[0]?.event;
  if(previous) {
    const p=previous.payload;
    if(p.operation!=="owner_corrected"||p.supersedes!==input.memoryId||p.statement!==input.text||p.expectedVersion!==input.expectedVersion)
      throw new IdempotencyKeyReusedError("memory-correction");
    return {memoryId:String(p.memoryId)};
  }
  old=await tx.memories.findOwned(input.userId,input.memoryId);
  if(old.status!=="CONSOLIDATED"||old.version!==input.expectedVersion)throw new StaleWriteError("Memory",input.expectedVersion,old.version);
  if(old.type==="CORE")throw new DomainValidationError("Core memories require candidate confirmation");
  const store=tx.continuityProcessing;
  if(!store.findSlotByMemory)throw new PersistenceConflictError("Memory slot review is unavailable");
  const slot=await store.findSlotByMemory(input.userId,old.yaoyaoId,old.memoryId);
  const parsed=extractExplicitMemories(input.text);
  const candidate=parsed[0];
  if(!slot||parsed.length!==1||!candidate||candidate.kind!=="fact"||candidate.slot!==slot.slot||
    candidate.content!==input.text.replace(/[。！.!]$/u,"").trim()||candidate.value===slot.value||candidate.type!==old.type)
    throw new DomainValidationError("Correction must explicitly replace one fact in the same memory slot");
  const sourceId=newEventId();
  const correction=old.correct({content:"用户陈述："+candidate.content,confidence:1,sourceEvents:[sourceId]});
  const recorded=await tx.events.append({event:DomainEvent.create({eventId:sourceId,type:"MEMORY_CORRECTED",actor:"USER",source:"CLIENT",
    userId:input.userId,yaoyaoId:old.yaoyaoId,correlationId,payload:{operation:"owner_corrected",memoryId:correction.current.memoryId,
      supersedes:old.memoryId,statement:input.text,expectedVersion:input.expectedVersion,policy:"memory-owner-edit-v1"}})});
  await tx.memories.save(input.userId,correction.superseded);
  await tx.memories.insert(correction.current);
  await store.setSlot(input.userId,old.yaoyaoId,slot.slot,candidate.value,correction.current.memoryId,recorded.aggregateSeq);
  await tx.experience?.setMuted(input.userId,slot.slot,null);
  return {memoryId:String(correction.current.memoryId)};
}
