import{afterAll,beforeAll,describe,expect,it}from'vitest';
import{initializeYaoYao,persistUserMessage,persistAssistantMessage,runContinuityOnce,resolveMemoryCandidate,replayMemoryEvaluation,loadConversationHistory,type CandidateAudit}from'@yaoyao/application';
import{newUserId,LEGACY_MEMORY_POLICY,scoreMemory,type UserId,type YaoYaoId}from'@yaoyao/domain';
import{dockerAvailable,setupDatabase,type TestDatabase}from'./helpers.js';
const available=await dockerAvailable();
describe.skipIf(!available)('005BC durable memory and context',()=>{
 let db:TestDatabase;
 beforeAll(async()=>{db=await setupDatabase();},120000);afterAll(async()=>{await db?.teardown();});
 async function owner(){const userId=newUserId();const data=await db.manager.runAsUser(userId,tx=>initializeYaoYao(tx,{userId,email:userId+'@quality.test',passwordHash:'h'}));return{userId,yaoyaoId:data.yaoyaoId};}
 async function turn(o:{userId:UserId;yaoyaoId:YaoYaoId},text:string,id:string){const input={...o,text,requestId:id,traceId:id,sessionId:null};await db.manager.runAsUser(o.userId,tx=>persistUserMessage(tx,input));await db.manager.runAsUser(o.userId,tx=>persistAssistantMessage(tx,{...input,text:'收到。'}));}
 it('persists natural preferences, supersedes explicit negation and ignores today-only state',async()=>{
  const o=await owner();for(const[id,text]of[['p','我最近更喜欢喝咖啡了。'],['t','我今天不想喝咖啡。'],['n','我现在不喝咖啡了。']]){await turn(o,text,id);expect(await runContinuityOnce(db.manager,o.userId)).toBe('completed');}
  const rows=await db.manager.runAsUser(o.userId,tx=>tx.memories.listOwned(o.userId));expect(rows).toHaveLength(2);
  expect(rows.find(m=>m.status==='CORRECTED')?.content).toContain('更喜欢喝咖啡');expect(rows.find(m=>m.status==='CONSOLIDATED')?.content).toContain('不喝咖啡');
  expect(rows.every(m=>m.sourceEvents.length===1)).toBe(true);
 });
 it('holds uncertain values, allows only owner confirmation, and replays recorded scores',async()=>{
  const o=await owner(),other=await owner();await turn(o,'我可能住在上海。','u');await runContinuityOnce(db.manager,o.userId);
  expect(await db.manager.runAsUser(o.userId,tx=>tx.memories.listOwned(o.userId))).toHaveLength(0);
  const rows=await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listAudits(o.userId,10));const held=rows[0];expect((held.audit as CandidateAudit).outcome).toBe('held');
  await expect(db.manager.runAsUser(other.userId,tx=>resolveMemoryCandidate(tx,other.userId,String(held.job_id),0,'confirm'))).rejects.toThrow();
  const replay=await db.manager.runAsUser(o.userId,tx=>replayMemoryEvaluation(tx,o.userId,String(held.job_id),0));expect(replay.matches).toBe(true);
  const confirm=()=>db.manager.runAsUser(o.userId,tx=>resolveMemoryCandidate(tx,o.userId,String(held.job_id),0,'confirm'));
  expect(await confirm()).toEqual(await confirm());expect(await db.manager.runAsUser(o.userId,tx=>tx.memories.listOwned(o.userId))).toHaveLength(1);
 });
 it('keeps legacy held audits confirmable under the frozen v1 parser',async()=>{
  const o=await owner();await turn(o,'我现在喜欢咖啡了。','legacy');
  await db.manager.runAsUser(o.userId,async tx=>{
   const job=await tx.continuity.claimNext(o.userId,60);expect(job).not.toBeNull();
   const events=await tx.events.readOwnedAfter(o.userId,o.yaoyaoId,0);const user=events.find(e=>e.event.type==='USER_MESSAGE')!;
   const inputs={importance:.7,relevance:.65,confidence:.9,novelty:1,recurrence:0};
   await tx.continuityProcessing.recordCandidate(o.userId,o.yaoyaoId,job!.jobId,0,{policy:LEGACY_MEMORY_POLICY,sourceEventId:String(user.event.eventId),candidate:{content:'我现在喜欢咖啡了',evidence:'我现在喜欢咖啡了',slot:'user:preference:咖啡了',value:'咖啡了',type:'SEMANTIC',kind:'fact',confidence:.9,importance:.7,relevance:.65,explicitCorrection:true},inputs,score:scoreMemory(inputs),outcome:'held',reason:'conflict_needs_confirmation',memoryId:null});
   await tx.continuityProcessing.recordRun(o.userId,o.yaoyaoId,job!.jobId,{policy:LEGACY_MEMORY_POLICY,held:1});await tx.continuity.complete(o.userId,job!.jobId,job!.leaseToken);
  });
  const audits=await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listAudits(o.userId,10));const id=String(audits[0].job_id);
  expect((await db.manager.runAsUser(o.userId,tx=>replayMemoryEvaluation(tx,o.userId,id,0))).matches).toBe(true);
  expect((await db.manager.runAsUser(o.userId,tx=>resolveMemoryCandidate(tx,o.userId,id,0,'confirm'))).memoryId).toBeTruthy();
 });
 it('excludes current turn before LIMIT in the real owner-scoped SQL window',async()=>{
  const o=await owner(),other=await owner();await turn(o,'过去的内容','past');await turn(other,'别人的内容','other');
  await db.manager.runAsUser(o.userId,tx=>persistUserMessage(tx,{...o,text:'当前内容',requestId:'current',traceId:'current',sessionId:null}));
  const rows=await db.manager.runAsUser(o.userId,tx=>loadConversationHistory(tx,{...o,limit:2,excludeRequestId:'current'}));
  expect(rows.map(r=>r.text)).toEqual(['过去的内容','收到。']);
 });
});
