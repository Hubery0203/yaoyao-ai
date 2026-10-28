import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PostgresTransactionManager} from '@yaoyao/infrastructure';
import {INCOMING_IMAGE_TEXT,recordIncomingImageResponse,recordIncomingAudioResponse,loadConversationHistory,incomingImageContext,runContinuityOnce,DEFAULT_PREFERENCES} from '@yaoyao/application';
import {CONVERSATION_ORCHESTRATOR,type ConversationOrchestrator} from '@yaoyao/runtime';
import type {UserId} from '@yaoyao/domain';
import {experienceForTurn} from '../../../core/runtime/src/conversation/experience.js';
import {renderHistoryTurn} from '../../../core/runtime/src/conversation/history.js';
import {residenceRecallUnknown} from '../../../core/runtime/src/conversation/memory-context.js';
import {dockerAvailable,setupApi,registerUser,type ApiTestContext} from './helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('multimodal continuity across persisted media and later typed correction',()=>{
 let ctx:ApiTestContext,manager:PostgresTransactionManager,owner:Awaited<ReturnType<typeof registerUser>>,other:Awaited<ReturnType<typeof registerUser>>,core:ConversationOrchestrator;
 beforeAll(async()=>{ctx=await setupApi();manager=new PostgresTransactionManager(ctx.db.appPool);owner=await registerUser(ctx,'media-continuity-owner@example.com');other=await registerUser(ctx,'media-continuity-other@example.com');core=ctx.app.get(CONVERSATION_ORCHESTRATOR);},120000);
 afterAll(async()=>{await ctx?.teardown();});
 it('keeps typed-image-voice source and order after reloading through production persistence',async()=>{
  await core.converse({userId:owner.userId,text:'先看看这束花',requestId:'media-text',traceId:'media-text'});
  await manager.runAsUser(owner.userId as UserId,tx=>recordIncomingImageResponse(tx,{userId:owner.userId as UserId,text:INCOMING_IMAGE_TEXT+'\n我明天要面试',requestId:'media-image',reply:'图里有一束花。'}));
  await manager.runAsUser(owner.userId as UserId,tx=>recordIncomingAudioResponse(tx,{userId:owner.userId as UserId,text:'我住在东京',requestId:'media-voice',reply:'听到了。'}));
  const history=await manager.runAsUser(owner.userId as UserId,async tx=>{const {yaoyaoId}=await tx.aggregates.loadOwned(owner.userId as UserId);return loadConversationHistory(tx,{userId:owner.userId as UserId,yaoyaoId,limit:20});});
  expect(history.map(t=>t.role)).toEqual(['user','assistant','user','assistant','user','assistant']);expect(history.filter(t=>t.role==='user').map(t=>t.attachment)).toEqual([undefined,'image','voice']);expect(history.filter(t=>t.role==='assistant').every(t=>!t.attachment)).toBe(true);
  const context=await manager.runAsUser(owner.userId as UserId,tx=>incomingImageContext(tx,owner.userId as UserId,'new-image'));expect(context).toHaveLength(6);expect(context[2].attachment).toBe('image');expect(context[4].attachment).toBe('voice');expect(JSON.stringify(context)).not.toContain('media-voice');
 });
 it('does not expose another owner or the current image request in bounded visual context',async()=>{
  expect(await manager.runAsUser(other.userId as UserId,tx=>incomingImageContext(tx,other.userId as UserId,'new-image'))).toEqual([]);
  const context=await manager.runAsUser(owner.userId as UserId,tx=>incomingImageContext(tx,owner.userId as UserId,'media-image'));expect(context.some(t=>t.attachment==='image')).toBe(false);expect(context.some(t=>t.attachment==='voice')).toBe(true);
 });
 it('does not create durable facts or projected life events from the media pair',async()=>{
  for(let i=0;i<10;i++)if(await runContinuityOnce(manager,owner.userId as UserId)==='idle')break;
  expect((await ctx.db.adminPool.query('SELECT count(*)::int n FROM memories WHERE user_id=$1',[owner.userId])).rows[0].n).toBe(0);
  expect((await ctx.db.adminPool.query('SELECT count(*)::int n FROM life_events WHERE user_id=$1',[owner.userId])).rows[0].n).toBe(0);
  const history=await manager.runAsUser(owner.userId as UserId,async tx=>{const {yaoyaoId}=await tx.aggregates.loadOwned(owner.userId as UserId);return loadConversationHistory(tx,{userId:owner.userId as UserId,yaoyaoId,limit:20});});
  expect(experienceForTurn({preferences:{...DEFAULT_PREFERENCES},lifeEvents:[]},'嗯',history,new Date())?.lifeEvents).toEqual([]);expect(residenceRecallUnknown('我住哪里？',history.map(renderHistoryTurn))).toBe(true);
 });
 it('preserves the media history while a later typed correction supplies the owner evidence, with replay unchanged',async()=>{
  const input={userId:owner.userId,text:'我现在住在大阪',requestId:'media-correction',traceId:'media-correction'};const first=await core.converse(input),replay=await core.converse(input);expect(replay.response).toBe(first.response);
  const history=await manager.runAsUser(owner.userId as UserId,async tx=>{const {yaoyaoId}=await tx.aggregates.loadOwned(owner.userId as UserId);return loadConversationHistory(tx,{userId:owner.userId as UserId,yaoyaoId,limit:20});});
  expect(history.filter(t=>t.text==='我现在住在大阪')).toHaveLength(1);expect(history.some(t=>t.attachment==='voice'&&t.text==='我住在东京')).toBe(true);expect(residenceRecallUnknown('我住哪里？',history.map(renderHistoryTurn))).toBe(false);
 });
});
