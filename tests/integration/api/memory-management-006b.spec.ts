import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
import {PostgresTransactionManager} from '@yaoyao/infrastructure';
import {persistUserMessage,persistAssistantMessage,runContinuityOnce} from '@yaoyao/application';
import type {UserId,YaoYaoId} from '@yaoyao/domain';
const hasDocker=await dockerAvailable();
describe.skipIf(!hasDocker)('006B real owner memory management',()=>{
 let ctx:ApiTestContext,manager:PostgresTransactionManager;
 beforeAll(async()=>{ctx=await setupApi();manager=new PostgresTransactionManager(ctx.db.appPool);},120000);
 afterAll(async()=>ctx?.teardown(),60000);
 async function seed(email:string,text='我住在杭州。'){
  const u=await registerUser(ctx,email);const input={userId:u.userId as UserId,yaoyaoId:u.yaoyaoId as YaoYaoId,text,requestId:'seed',traceId:'seed',sessionId:null};
  await manager.runAsUser(input.userId,tx=>persistUserMessage(tx,input));await manager.runAsUser(input.userId,tx=>persistAssistantMessage(tx,{...input,text:'收到'}));expect(await runContinuityOnce(manager,input.userId)).toBe('completed');
  const memories=await ctx.http.get('/api/v1/memories?status=CONSOLIDATED').set(authHeader(u.accessToken));return {u,m:memories.body.data.memories[0]};
 }
 it('corrects atomically, preserves owner source/history and replays after reconnect',async()=>{
  const {u,m}=await seed('006b-correct@yaoyao.test');const path=`/api/v1/memories/${m.memoryId}/correct`,body={text:'我现在住在苏州。',expectedVersion:m.version};
  const first=await ctx.http.post(path).set(authHeader(u.accessToken)).set('Idempotency-Key','edit-one').send(body);expect(first.status).toBe(200);
  const id=first.body.data.memoryId;expect(id).not.toBe(m.memoryId);
  const detail=await ctx.http.get(`/api/v1/memories/${id}/detail`).set(authHeader(u.accessToken));expect(detail.status).toBe(200);expect(detail.body.data.memory.content).toContain('苏州');expect(detail.body.data.history[0].status).toBe('CORRECTED');expect(detail.body.data.sources).toEqual([expect.objectContaining({text:body.text,kind:'owner_correction'})]);expect(detail.body.data.canCorrect).toBe(true);
  const replay=await ctx.http.post(path).set(authHeader(u.accessToken)).set('Idempotency-Key','edit-one').send(body);expect(replay.body).toEqual(first.body);
  const changed=await ctx.http.post(path).set(authHeader(u.accessToken)).set('Idempotency-Key','edit-one').send({...body,text:'我现在住在南京。'});expect(changed.status).toBe(409);
  const stale=await ctx.http.post(path).set(authHeader(u.accessToken)).set('Idempotency-Key','new-key').send(body);expect(stale.status).toBe(409);
  const rows=await ctx.db.adminPool.query("SELECT count(*)::int AS n FROM events WHERE user_id=$1 AND correlation_id='memory-edit:edit-one'",[u.userId]);expect(rows.rows[0].n).toBe(1);
  const original=await ctx.http.get(`/api/v1/memories/${m.memoryId}/detail`).set(authHeader(u.accessToken));expect(original.body.data.sources[0].text).toBe('我住在杭州。');expect(original.body.data.canCorrect).toBe(false);
 });
 it('isolates foreign owners and rejects invalid or uncertain/different-slot edits without side effects',async()=>{
  const {u,m}=await seed('006b-owner@yaoyao.test');const stranger=await registerUser(ctx,'006b-stranger@yaoyao.test');const path=`/api/v1/memories/${m.memoryId}`;
  expect((await ctx.http.get(path+'/detail')).status).toBe(401);expect((await ctx.http.get(path+'/detail').set(authHeader(stranger.accessToken))).status).toBe(404);
  expect((await ctx.http.post(path+'/correct').set(authHeader(stranger.accessToken)).set('Idempotency-Key','foreign').send({text:'我现在住在苏州。',expectedVersion:m.version})).status).toBe(404);
  for(const [i,text]of ['我可能住在苏州。','我喜欢喝咖啡。','我现在住在苏州。我叫小雨。'].entries())expect((await ctx.http.post(path+'/correct').set(authHeader(u.accessToken)).set('Idempotency-Key','reject-'+i).send({text,expectedVersion:m.version})).status).toBe(422);
  expect((await ctx.http.post(path+'/correct').set(authHeader(u.accessToken)).send({text:'我现在住在苏州。',expectedVersion:m.version})).status).toBe(400);
  expect((await ctx.http.get(path+'/detail').set(authHeader(u.accessToken))).body.data.memory.status).toBe('CONSOLIDATED');
 });
 it('corrects preference polarity and keeps CORE behind confirmation',async()=>{
  const {u,m}=await seed('006b-preference@yaoyao.test','我喜欢喝咖啡。');
  const path=`/api/v1/memories/${m.memoryId}`;
  const response=await ctx.http.post(path+'/correct').set(authHeader(u.accessToken)).set('Idempotency-Key','negative').send({text:'我现在不喝咖啡了。',expectedVersion:m.version});expect(response.status).toBe(200);
  const id=response.body.data.memoryId;
  await ctx.db.adminPool.query("UPDATE memories SET type='CORE' WHERE memory_id=$1",[id]);
  const detail=await ctx.http.get(`/api/v1/memories/${id}/detail`).set(authHeader(u.accessToken));expect(detail.body.data.canCorrect).toBe(false);
  expect((await ctx.http.post(`/api/v1/memories/${id}/correct`).set(authHeader(u.accessToken)).set('Idempotency-Key','core-reject').send({text:'我喜欢喝咖啡。',expectedVersion:detail.body.data.memory.version})).status).toBe(422);
 });
 it('serializes two competing corrections so exactly one wins',async()=>{
  const {u,m}=await seed('006b-race@yaoyao.test');const results=await Promise.all(['苏州','南京'].map((city,i)=>ctx.http.post(`/api/v1/memories/${m.memoryId}/correct`).set(authHeader(u.accessToken)).set('Idempotency-Key','race-'+i).send({text:'我现在住在'+city+'。',expectedVersion:m.version})));expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const current=await ctx.http.get('/api/v1/memories?status=CONSOLIDATED').set(authHeader(u.accessToken));expect(current.body.data.total).toBe(1);
 });
 it('protects manual corrections from an older queued conversation',async()=>{
  const {u,m}=await seed('006b-delay@yaoyao.test');const input={userId:u.userId as UserId,yaoyaoId:u.yaoyaoId as YaoYaoId,text:'我现在住在南京。',requestId:'older-queued',traceId:'older-queued',sessionId:null};
  await manager.runAsUser(input.userId,tx=>persistUserMessage(tx,input));await manager.runAsUser(input.userId,tx=>persistAssistantMessage(tx,{...input,text:'知道了'}));
  expect((await ctx.http.post(`/api/v1/memories/${m.memoryId}/correct`).set(authHeader(u.accessToken)).set('Idempotency-Key','manual-after-queued').send({text:'我现在住在苏州。',expectedVersion:m.version})).status).toBe(200);
  expect(await runContinuityOnce(manager,input.userId)).toBe('completed');const current=await ctx.http.get('/api/v1/memories?status=CONSOLIDATED').set(authHeader(u.accessToken));expect(current.body.data.memories[0].content).toContain('苏州');
  const pending=await ctx.http.get('/api/v1/memories/review').set(authHeader(u.accessToken));expect(pending.body.data.rows.some((r:{audit:{reason:string}})=>r.audit.reason==='older_than_current_memory')).toBe(true);
 });
 it('paginates review beyond old audits, counts pending separately and shows resolutions',async()=>{
  const {u}=await seed('006b-review@yaoyao.test','我可能住在杭州。');
  const listing=await ctx.http.get('/api/v1/memories/review').set(authHeader(u.accessToken));expect(listing.status).toBe(200);expect(listing.body.data.pendingTotal).toBe(1);const row=listing.body.data.rows[0];
  // Existing valid FK/owner job reused with new ordinals; deterministic historical fixture.
  await ctx.db.adminPool.query(`INSERT INTO memory_candidate_audits(job_id,ordinal,user_id,yaoyao_id,audit)
    SELECT job_id,g,user_id,yaoyao_id,audit FROM memory_candidate_audits CROSS JOIN generate_series(1,104) g WHERE job_id=$1 AND ordinal=0`,[row.job_id]);
  const page=await ctx.http.get('/api/v1/memories/review?limit=50&offset=100').set(authHeader(u.accessToken));expect(page.body.data.rows).toHaveLength(5);expect(page.body.data.total).toBe(105);expect(page.body.data.pendingTotal).toBe(105);expect(JSON.stringify(page.body.data)).not.toContain('inputs');
  await ctx.http.post(`/api/v1/memories/candidates/${row.job_id}/${row.ordinal}/resolve`).set(authHeader(u.accessToken)).send({decision:'discard'});
  const resolved=await ctx.http.get('/api/v1/memories/review?status=resolved').set(authHeader(u.accessToken));expect(resolved.body.data.total).toBe(1);expect(resolved.body.data.pendingTotal).toBe(104);expect(resolved.body.data.rows[0].resolution.decision).toBe('discard');
 });
});
