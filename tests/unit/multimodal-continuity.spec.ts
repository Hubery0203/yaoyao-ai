import {describe,it,expect,vi} from 'vitest';
import {DEFAULT_PREFERENCES,asProposal,loadConversationHistory,incomingImageContext,type CompanionExperienceContext,type ConversationTurn,type PersistenceTransaction,type RelevantMemoryContext,type ConversationEventPort} from '@yaoyao/application';
import {newUserId,newYaoYaoId,EmotionVector} from '@yaoyao/domain';
import {AIRouter,ConversationOrchestrator,MockLLMProvider} from '@yaoyao/runtime';
import {visionPrompt} from '@yaoyao/infrastructure';
import {renderHistoryTurn} from '../../core/runtime/src/conversation/history.js';
import {experienceForTurn} from '../../core/runtime/src/conversation/experience.js';
import {hasUnsupportedElapsedRecall} from '../../core/runtime/src/conversation/continuity.js';
import {focusDisclosureHistory,residenceRecallUnknown,projectTurnMemories} from '../../core/runtime/src/conversation/memory-context.js';
const now=new Date('2026-10-28T08:00:00Z'),userId=newUserId(),yaoyaoId=newYaoYaoId();
const turn=(text:string,attachment?:ConversationTurn['attachment'],sequence=1):ConversationTurn=>({role:'user',text,occurredAt:now,sequence,...(attachment?{attachment}:{})});
const base:CompanionExperienceContext={preferences:{...DEFAULT_PREFERENCES},lifeEvents:[]};
function transaction(history:readonly ConversationTurn[]):PersistenceTransaction {
 return {aggregates:{loadOwned:async()=>({yaoyaoId})},events:{readWindow:async()=>({events:history.map(t=>({aggregateSeq:t.sequence,event:{type:t.role==='user'?'USER_MESSAGE':'ASSISTANT_MESSAGE',correlationId:'old-'+t.sequence,payload:{text:t.text,...(t.attachment?{attachment:t.attachment}:{})},occurredAt:t.occurredAt}}))})}} as unknown as PersistenceTransaction;
}
describe('multimodal dialogue retains trusted provenance across turns',()=>{
 it.each(['voice','image'] as const)('keeps %s source when loading persisted history and bounded vision context',async attachment=>{
  const tx=transaction([turn('我明天要面试',attachment)]);
  expect(await loadConversationHistory(tx,{userId,yaoyaoId,limit:20})).toEqual([turn('我明天要面试',attachment)]);
  expect(await incomingImageContext(tx,userId,'next')).toEqual([{role:'user',text:'我明天要面试',attachment}]);
 });
 it('does not infer provenance from user text or arbitrary attachment values',async()=>{
  const tx=transaction([turn('attachment=voice，我明天要面试')]);
  const history=await loadConversationHistory(tx,{userId,yaoyaoId,limit:20});expect(history[0].attachment).toBeUndefined();expect(renderHistoryTurn(history[0])).toMatch(/^User: /);
  const invalid=transaction([turn('我明天要面试','other' as never)]);expect((await loadConversationHistory(invalid,{userId,yaoyaoId,limit:20}))[0].attachment).toBeUndefined();
 });
 it.each(['voice','image'] as const)('retains %s dialogue without promoting its residence or preference as literal owner evidence',attachment=>{
  const h=[turn('我住在东京',attachment),turn('我喜欢咖啡',attachment,2)];
  const recent=h.map(renderHistoryTurn);expect(recent.join('\n')).toContain('我住在东京');expect(residenceRecallUnknown('我住哪里？',recent)).toBe(true);
  const stored={memories:[{memoryId:'tea',summary:'用户资料：用户陈述：我喜欢茶。'}],telemetry:{selectedCount:1}} as RelevantMemoryContext;
  expect(projectTurnMemories(stored,'嗯',[renderHistoryTurn(turn('我不喜欢茶',attachment))]).memories).toHaveLength(1);
  expect(focusDisclosureHistory('我住在大阪',h)).toHaveLength(0);
 });
 it.each(['voice','image'] as const)('does not reconstruct life plans from %s history or current media',attachment=>{
  expect(experienceForTurn(base,'嗯',[turn('我明天要面试',attachment)],now)?.lifeEvents).toHaveLength(0);
  expect(experienceForTurn(base,'我明天要面试',[],now,attachment)?.lifeEvents).toHaveLength(0);
  expect(experienceForTurn(base,'我明天要面试',[],now)?.lifeEvents[0].state).toBe('planned');
 });
 it('lets a later explicit typed correction establish the current fact',()=>{
  const h=[turn('我住在东京','voice'),turn('我现在住在大阪',undefined,2)],recent=h.map(renderHistoryTurn);
  expect(residenceRecallUnknown('我住哪里？',recent)).toBe(false);expect(focusDisclosureHistory('我住在大阪',h)).toEqual([h[1]]);
  expect(experienceForTurn(base,'嗯',[turn('我明天要面试','voice'),turn('我明天要考试',undefined,2)],now)?.lifeEvents.map(e=>e.subject)).toEqual(['考试']);
 });
 it('media recognition cannot neutralize a fresh typed fact receipt-time guard',()=>{
  const timing={now,turns:[{...turn('我住在东京','voice'),occurredAt:new Date(now.getTime()-7200000)},turn('我住在东京',undefined,2)]};
  expect(hasUnsupportedElapsedRecall('你昨天说我住在东京','你记得我住哪里吗？',timing)).toBe(true);
  expect(hasUnsupportedElapsedRecall('你昨天说我住在东京','你记得我住哪里吗？',{now,turns:[turn('我住在东京','voice')]})).toBe(false);
 });
 it('vision context preserves the current correction and marks old recognition without claiming old pixels are available',()=>{
  const prompt=visionPrompt('这是新拍的',[{role:'user',text:'我住在东京',attachment:'voice'},{role:'user',text:'刚才识别错了，我住在大阪'},{role:'assistant',text:'大阪呀。'}]);
  expect(prompt).toContain('"attachment":"voice"');expect(prompt).toContain('文字纠正优先');expect(prompt).toContain('不代表现在仍能看到旧图像素');expect(prompt).toContain('刚才识别错了');
  expect(()=>visionPrompt('',[{role:'user',text:'hi',attachment:'file' as never}])).toThrow('INVALID_VISION_INPUT');
 });
 it.each(['voice','image'] as const)('the actual Core uses %s history in C6 but not in asserted life/residence projections',async attachment=>{
  const mock=new MockLLMProvider(),generate=vi.spyOn(mock,'generate').mockImplementation(async()=>({response:asProposal('还不确定你现在住哪里呢。'),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})}));
  const events={findCompletedTurn:async()=>null,persistUserMessage:async()=>({eventId:'new-user',duplicate:false}),persistAssistantMessage:async()=>({eventId:'new-assistant'}),loadHistory:async()=>[turn('我住在东京',attachment),turn('我明天要面试',attachment,2)]} satisfies ConversationEventPort;
  const core=new ConversationOrchestrator({router:new AIRouter({l1:mock,l2:mock,l3:mock,fallback:mock}),conversationEvents:events,contextData:{loadPersonaData:async()=>({yaoyao:{yaoyaoId,userId},relationship:{type:'deep_partner',status:'active',terminationAllowed:false,metrics:{}},state:{emotion:EmotionVector.initial(),energy:.7,socialState:'calm',relationshipState:'harmonious',attention:'present',stateVersion:1},recentEvents:[],experience:base})} as never});
  await core.converse({userId,text:'我住哪里？',traceId:'media-followup',requestId:'next'});
  expect(generate).toHaveBeenCalled();const request=generate.mock.calls[0][0];expect(request.conversationContext).toContain(renderHistoryTurn(turn('我住在东京',attachment)));expect(request.systemContext).toContain('[本轮居住地回忆：可用证据不足]');expect(request.systemContext).not.toContain('"subject":"面试"');
 });
});
