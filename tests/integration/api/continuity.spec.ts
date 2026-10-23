import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext } from "./helpers.js";
import { PostgresTransactionManager } from "@yaoyao/infrastructure";
import { persistUserMessage,persistAssistantMessage,runContinuityOnce } from "@yaoyao/application";
import type { UserId,YaoYaoId } from "@yaoyao/domain";
const HAS_DOCKER=await dockerAvailable();
describe.skipIf(!HAS_DOCKER)("MVP-003 owner operations API",()=>{
 let ctx:ApiTestContext;
 beforeAll(async()=>{ctx=await setupApi();},120000);
 afterAll(async()=>{await ctx?.teardown();},60000);
 it("authenticates diagnostics and validates review/requeue inputs",async()=>{
  const user=await registerUser(ctx,"continuity-http@yaoyao.test");
  expect((await ctx.http.get("/api/v1/memories/candidates")).status).toBe(401);
  expect((await ctx.http.get("/api/v1/memories/continuity-jobs").set(authHeader(user.accessToken))).status).toBe(200);
  expect((await ctx.http.post("/api/v1/memories/candidates/invalid/0/resolve").set(authHeader(user.accessToken)).send({decision:"confirm"})).status).toBe(400);
  expect((await ctx.http.post("/api/v1/memories/continuity-jobs/invalid/requeue").set(authHeader(user.accessToken))).status).toBe(400);
 });
 it("reviews a held candidate without exposing another owner's evidence",async()=>{
  const user=await registerUser(ctx,"review-http@yaoyao.test");
  const other=await registerUser(ctx,"other-review-http@yaoyao.test");
  const manager=new PostgresTransactionManager(ctx.db.appPool);
  for(const [requestId,text] of [["a","我住在杭州。"],["b","我住在上海。"]]){
   const input={userId:user.userId as UserId,yaoyaoId:user.yaoyaoId as YaoYaoId,text,requestId,traceId:requestId,sessionId:null};
   await manager.runAsUser(input.userId,tx=>persistUserMessage(tx,input));
   await manager.runAsUser(input.userId,tx=>persistAssistantMessage(tx,{...input,text:"好的"}));
   expect(await runContinuityOnce(manager,input.userId)).toBe("completed");
  }
  const listing=await ctx.http.get("/api/v1/memories/candidates").set(authHeader(user.accessToken));
  expect(listing.status).toBe(200);
  const held=listing.body.data.find((r:{audit:{outcome:string}})=>r.audit.outcome==="held");
  expect(held).toBeDefined();
  const evaluation=await ctx.http.get(`/api/v1/memories/candidates/${held.job_id}/${held.ordinal}/evaluation`).set(authHeader(user.accessToken));
  expect(evaluation.status).toBe(200);expect(evaluation.body.data.matches).toBe(true);
  const path=`/api/v1/memories/candidates/${held.job_id}/${held.ordinal}/resolve`;
  const denied=await ctx.http.post(path).set(authHeader(other.accessToken)).send({decision:"confirm"});
  expect(denied.status).toBe(404);
  const confirmed=await ctx.http.post(path).set(authHeader(user.accessToken)).send({decision:"confirm"});
  expect(confirmed.status).toBe(201);expect(confirmed.body.data.memoryId).toBeTruthy();
  const repeated=await ctx.http.post(path).set(authHeader(user.accessToken)).send({decision:"confirm"});
  expect(repeated.body.data).toEqual(confirmed.body.data);
  const invalid=await ctx.http.post(path).set(authHeader(user.accessToken)).send({decision:"invent"});
  expect(invalid.status).toBe(400);
 });
});
