import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { initializeYaoYao, persistUserMessage, persistAssistantMessage, processContinuityJob,
  runContinuityOnce, resolveMemoryCandidate, advanceTemporalEmotion, type ContinuityJob } from "@yaoyao/application";
import { DomainEvent, newUserId, scoreMemory, extractExplicitMemories, type UserId, type YaoYaoId } from "@yaoyao/domain";
import { PostgresMemoryRetrievalAdapter } from "@yaoyao/infrastructure";
import { dockerAvailable, setupDatabase, type TestDatabase } from "./helpers.js";
const HAS_DOCKER=await dockerAvailable();
describe.skipIf(!HAS_DOCKER)("MVP-003 memory/emotion/continuity acceptance",()=>{
  let db:TestDatabase;
  beforeAll(async()=>{db=await setupDatabase();},120000);
  afterAll(async()=>{await db?.teardown();});
  async function owner(){
    const userId=newUserId();
    const init=await db.manager.runAsUser(userId,tx=>initializeYaoYao(tx,{userId,email:`${userId}@example.com`,passwordHash:"h"}));
    return {userId,yaoyaoId:init.yaoyaoId};
  }
  async function turn(o:{userId:UserId;yaoyaoId:YaoYaoId},text:string,id:string){
    const input={...o,text,requestId:id,traceId:id,sessionId:null};
    await db.manager.runAsUser(o.userId,tx=>persistUserMessage(tx,input));
    await db.manager.runAsUser(o.userId,tx=>persistAssistantMessage(tx,{...input,text:"我记住了。我住在火星。"}));
  }
  async function claim(userId:UserId):Promise<ContinuityJob>{
    const job=await db.manager.runAsUser(userId,tx=>tx.continuity.claimNext(userId,60));
    expect(job).not.toBeNull();return job!;
  }
  async function memories(userId:UserId){return db.manager.runAsUser(userId,tx=>tx.memories.listOwned(userId));}
  it("consolidates grounded user facts, audits replayable inputs and serves C4",async()=>{
    const o=await owner();await turn(o,"我住在杭州。","a");
    expect(await runContinuityOnce(db.manager,o.userId)).toBe("completed");
    const rows=await memories(o.userId);
    expect(rows).toHaveLength(1);expect(rows[0].content).toBe("用户陈述：我住在杭州");
    expect(rows[0].sourceEvents).toHaveLength(1);
    const audits=await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listAudits(o.userId,10));
    const audit=audits[0].audit as {inputs:Parameters<typeof scoreMemory>[0];score:number};
    expect(scoreMemory(audit.inputs)).toBe(audit.score);
    const state=await db.manager.runAsUser(o.userId,tx=>tx.states.findOwned(o.userId));
    expect(state.internalState.recentReflection).toBe("用户陈述：我住在杭州");
    const read=new PostgresMemoryRetrievalAdapter(db.appPool);
    const selected=await read.retrieve({userId:o.userId,yaoyaoId:o.yaoyaoId,currentInput:"我住在杭州",situation:{intent:"chat",urgency:"normal",taskNature:"general"},relationshipContext:{type:"deep_partner",status:"active"},limit:5,recentConversation:[],traceId:"retrieve"});
    expect(JSON.stringify(selected)).toContain("杭州");
    expect(await runContinuityOnce(db.manager,o.userId)).toBe("idle");
  });
  it("deduplicates evidence and never mines the assistant's invented claims",async()=>{
    const o=await owner();
    for(const id of ["a","b"]){await turn(o,"我喜欢咖啡。",id);await runContinuityOnce(db.manager,o.userId);}
    expect(await memories(o.userId)).toHaveLength(1);
    const audits=await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listAudits(o.userId,10));
    expect(audits.map(a=>(a.audit as {outcome:string}).outcome).sort()).toEqual(["consolidated","duplicate"]);
  });
  it("holds conflicting facts until explicit owner review and keeps history",async()=>{
    const o=await owner();await turn(o,"我住在杭州。","a");await runContinuityOnce(db.manager,o.userId);
    await turn(o,"我住在上海。","b");await runContinuityOnce(db.manager,o.userId);
    const auditRows=await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listAudits(o.userId,10));
    const held=auditRows.find(a=>(a.audit as {outcome:string}).outcome==="held")!;
    expect(held).toBeDefined();expect(await memories(o.userId)).toHaveLength(1);
    const confirm=()=>db.manager.runAsUser(o.userId,tx=>resolveMemoryCandidate(tx,o.userId,String(held.job_id),0,"confirm"));
    const results=await Promise.all([confirm(),confirm()]);expect(results[0]).toEqual(results[1]);
    const rows=await memories(o.userId);expect(rows).toHaveLength(2);
    expect(rows.find(r=>r.status==="CORRECTED")?.content).toContain("杭州");
    const current=rows.find(r=>r.status==="CONSOLIDATED")!;
    expect(current.content).toContain("上海");expect(current.supersedes).not.toBeNull();
    const other=await owner();
    await expect(db.manager.runAsUser(other.userId,tx=>resolveMemoryCandidate(tx,other.userId,String(held.job_id),0,"confirm"))).rejects.toThrow();
    await expect(db.manager.runAsUser(o.userId,tx=>resolveMemoryCandidate(tx,o.userId,String(held.job_id),0,"discard"))).rejects.toThrow();
  });
  it("explicit changed facts supersede, but out-of-order older jobs cannot overwrite them",async()=>{
    const o=await owner();await turn(o,"我住在杭州。","old");
    const older=await claim(o.userId);
    await turn(o,"我现在住在上海。","new");const newer=await claim(o.userId);
    await db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,newer));
    const result=await db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,older));
    expect(result.held).toBe(1);
    const rows=await memories(o.userId);expect(rows).toHaveLength(1);expect(rows[0].content).toContain("上海");
    await turn(o,"我现在住在北京。","change");await runContinuityOnce(db.manager,o.userId);
    const after=await memories(o.userId);expect(after.filter(r=>r.status==="CONSOLIDATED")[0].content).toContain("北京");
  });
  it("rolls back all memory, reflection and audit side effects on a crash",async()=>{
    const o=await owner();await turn(o,"我叫Alice。","a");const job=await claim(o.userId);
    await expect(db.manager.runAsUser(o.userId,async tx=>{await processContinuityJob(tx,o.userId,job);throw new Error("crash");})).rejects.toThrow("crash");
    expect(await memories(o.userId)).toHaveLength(0);
    expect(await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listAudits(o.userId,10))).toHaveLength(0);
    expect(await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.readRun(o.userId,job.jobId))).toBeNull();
    await db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,job));
    expect(await memories(o.userId)).toHaveLength(1);
  });
  it("rejects stale workers before any effects and can recover after expiry",async()=>{
    const o=await owner();await turn(o,"我喜欢旅行。","a");const job=await claim(o.userId);
    await db.adminPool.query("UPDATE continuity_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE job_id=$1",[job.jobId]);
    await expect(db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,job))).rejects.toThrow("lease");
    expect(await memories(o.userId)).toHaveLength(0);
    await db.manager.runAsUser(o.userId,tx=>tx.continuity.sweepExpiredLeases(o.userId));
    await db.adminPool.query("UPDATE continuity_jobs SET available_at=clock_timestamp() WHERE job_id=$1",[job.jobId]);
    expect(await runContinuityOnce(db.manager,o.userId)).toBe("completed");
  });
  it("serializes two workers' consolidation without duplicate long-term memories",async()=>{
    const o=await owner();await turn(o,"我喜欢旅行。","a");await turn(o,"我喜欢旅行。","b");
    const a=await claim(o.userId),b=await claim(o.userId);
    await Promise.all([a,b].map(j=>db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,j))));
    expect(await memories(o.userId)).toHaveLength(1);
  });
  it("holds CORE candidates for confirmation; discards ungrounded proposals",async()=>{
    const o=await owner();await turn(o,"我叫Alice。","a");const job=await claim(o.userId);
    const candidate=extractExplicitMemories("我叫Alice。")[0];
    await db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,job,[{...candidate,type:"CORE"}]));
    expect(await memories(o.userId)).toHaveLength(0);
    await db.manager.runAsUser(o.userId,tx=>resolveMemoryCandidate(tx,o.userId,job.jobId,0,"confirm"));
    expect((await memories(o.userId))[0].type).toBe("CORE");
    await turn(o,"我现在叫Eve。","protected-core");
    expect(await runContinuityOnce(db.manager,o.userId)).toBe("completed");
    expect(await memories(o.userId)).toHaveLength(1);
    await turn(o,"我叫Bob。","b");const second=await claim(o.userId);
    const result=await db.manager.runAsUser(o.userId,tx=>processContinuityJob(tx,o.userId,second,[candidate]));
    expect(result.discarded).toBe(1);expect(await memories(o.userId)).toHaveLength(1);
  });
  it("backs off, exhausts retries, exposes failure, and accepts explicit owner requeue",async()=>{
    const o=await owner();await turn(o,"普通聊天","a");let last="";
    for(let i=0;i<5;i++){
      const job=await claim(o.userId);last=job.jobId;
      expect(await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.fail(o.userId,job.jobId,job.leaseToken))).toBe(true);
      expect(await db.manager.runAsUser(o.userId,tx=>tx.continuity.claimNext(o.userId,60))).toBeNull();
      await db.adminPool.query("UPDATE continuity_jobs SET available_at=clock_timestamp() WHERE job_id=$1",[job.jobId]);
    }
    const jobs=await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.listJobs(o.userId,10));
    expect(jobs[0].status).toBe("failed");expect(jobs[0].last_error).toBe("processing_failed");
    const other=await owner();expect(await db.manager.runAsUser(other.userId,tx=>tx.continuityProcessing.requeue(other.userId,last))).toBe(false);
    expect(await db.manager.runAsUser(o.userId,tx=>tx.continuityProcessing.requeue(o.userId,last))).toBe(true);
    expect(await runContinuityOnce(db.manager,o.userId)).toBe("completed");
  });
  it("evolves mixed emotions with traceable CAS; duplicate commands and reads do not write",async()=>{
    const o=await owner();
    await db.manager.runAsUser(o.userId,async tx=>{
      const current=await tx.states.findOwned(o.userId);
      const changes={emotion:{anger:1,hurt:1,affection:.9}};
      const next=current.transition(current.stateVersion,changes);
      await tx.states.saveStateIfVersionMatches(o.userId,current.stateVersion,next);
      await tx.events.append({event:DomainEvent.create({type:"STATE_CHANGED",actor:"SYSTEM",source:"CORE",...o,
        occurredAt:new Date(Date.now()-3*3600000),payload:{changes,expectedVersion:current.stateVersion,newVersion:next.stateVersion}})});
    });
    expect(await db.manager.runAsUser(o.userId,tx=>advanceTemporalEmotion(tx,o.userId,"advance"))).toBe(true);
    const after=await db.manager.runAsUser(o.userId,tx=>tx.states.findOwned(o.userId));
    expect(after.emotion.get("anger")).toBeCloseTo(.5,3);expect(after.emotion.get("hurt")).toBeGreaterThan(.9);
    expect(await db.manager.runAsUser(o.userId,tx=>advanceTemporalEmotion(tx,o.userId,"advance"))).toBe(false);
    const read=await db.manager.runAsUser(o.userId,tx=>tx.states.findOwned(o.userId));expect(read.stateVersion).toBe(after.stateVersion);
  });
  it("keeps audits immutable and prevents cross-owner reads",async()=>{
    const o=await owner();await turn(o,"我喜欢音乐。","a");await runContinuityOnce(db.manager,o.userId);
    const other=await owner();expect(await db.manager.runAsUser(other.userId,tx=>tx.continuityProcessing.listAudits(other.userId,10))).toHaveLength(0);
    await expect(db.adminPool.query("UPDATE memory_candidate_audits SET audit='{}' WHERE user_id=$1",[o.userId])).rejects.toThrow("append-only");
  });
  it("runs the built worker host and shuts down gracefully",async()=>{
    const o=await owner();await turn(o,"我喜欢阅读。","host");
    const proc=spawn(process.execPath,[join(__dirname,"../../../apps/worker/dist/main.js")],{stdio:"ignore",env:{...process.env,
      DATABASE_URL:db.connectionStringFor("yaoyao_app","yaoyao_app_test"),CONTINUITY_USER_IDS:String(o.userId),CONTINUITY_POLL_MS:"100"}});
    const exit=once(proc,"exit");
    try{
      let completed=false;
      for(let i=0;i<80;i++){
        const r=await db.adminPool.query("SELECT status FROM continuity_jobs WHERE user_id=$1",[o.userId]);
        if(r.rows[0]?.status==="completed"){completed=true;break;}
        if(proc.exitCode!==null)break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(completed).toBe(true);expect(await memories(o.userId)).toHaveLength(1);
    } finally {proc.kill("SIGTERM");}
    const [code]=await exit;expect(code).toBe(0);
  },15000);
});
