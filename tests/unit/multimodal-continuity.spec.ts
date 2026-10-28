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

import {hasAssertedMediaLifeOutcome,mediaHistoryGuidance,unconfirmedMediaLifeSubject} from '../../core/runtime/src/conversation/history.js';
import {dialogueStyleFailure} from '../../core/runtime/src/conversation/style.js';
import {baselineDecision,validateResponse,validationFailureSummary} from '@yaoyao/runtime';
import {buildFallbackResponse} from '../../core/runtime/src/validation/response.js';
describe('observed model failures: media assertions and invented senses',()=>{
 const input='我的面试结束了吗？',history=[turn('面试结束了','voice')];
 it('rejects the observed asserted outcome and does not let an uncertainty tail legitimize it',()=>{
  expect(hasAssertedMediaLifeOutcome('结束了，你自己说的呀——面试结束了。这会儿是不是刚松下来？',input,history,base)).toBe(true);
  expect(hasAssertedMediaLifeOutcome('结束了。不过还不确定。',input,history,base)).toBe(true);
  expect(hasAssertedMediaLifeOutcome('还不确定你的面试进展呢。',input,history,base)).toBe(false);
 });
 it('does not overrule a typed statement, confirmed life record, or unrelated request',()=>{
  expect(unconfirmedMediaLifeSubject(input,[...history,turn('面试结束了',undefined,2)],base)).toBeNull();
  const confirmed=experienceForTurn(base,'我明天要面试',[],now)!;expect(unconfirmedMediaLifeSubject(input,history,confirmed)).toBeNull();
  expect(unconfirmedMediaLifeSubject('帮我准备面试',history,base)).toBeNull();
 });
 it('gates and safely falls back through the actual validation interface without promoting recognition',()=>{
  const decision=baselineDecision({currentInput:input,emotion:{},situation:{intent:'question',urgency:'normal',taskNature:'general'},recentConversation:history.map(renderHistoryTurn),userId,yaoyaoId,personaTone:'warm',traceId:'media-evidence'});
  const proposal={response:asProposal('结束了，你自己说的呀。'),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})};
  expect(validateResponse({proposal,decision,userInput:input,recentConversation:history.map(renderHistoryTurn),experience:base,timing:{now,turns:history}})).toMatchObject({passed:false,reason:'continuity: unsupported media outcome'});
  expect(buildFallbackResponse({userInput:input,decision,experience:base,timing:{now,turns:history}})).toBe('还不确定你的面试进展呢。');expect(validationFailureSummary({stage:'continuity',reason:'continuity: unsupported media outcome'}).code).toBe('media_evidence');
 });
 it.each(['那我闻错了，咖啡的香气确实容易认成茶。','我也闻到咖啡香了。','我尝到了咖啡的味道。'])('rejects an invented real sense: %s',response=>expect(dialogueStyleFailure(response,'刚才那杯是咖啡，不是茶')).toBe('dialogue: invented offline activity'));
 it.each(['我闻不到那杯咖啡。','如果我闻到咖啡香，这只是个假设。','“我闻错了”是句对白。'])('preserves negation, hypothetical and quotation: %s',response=>expect(dialogueStyleFailure(response,'刚才那杯是咖啡，不是茶')).toBeNull());
 it('reserves provenance explanation for explicit questions and does not request old media automatically',()=>{
  expect(mediaHistoryGuidance(history)).toContain('不附带识别原理');expect(mediaHistoryGuidance(history)).toContain('当前没有旧图片像素');expect(mediaHistoryGuidance([turn('普通分享')])).toBe('');
 });
});

it('renders the narrow unconfirmed-media record answer briefly only after validation, with safety retained',()=>{
 const input='我的面试结束了吗？',history=[turn('面试结束了','voice')],decision=baselineDecision({currentInput:input,emotion:{},situation:{intent:'question',urgency:'normal',taskNature:'general'},recentConversation:history.map(renderHistoryTurn),userId,yaoyaoId,personaTone:'warm',traceId:'media-record'});
 const check=(response:string)=>validateResponse({proposal:{response:asProposal(response),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})},decision,userInput:input,recentConversation:history.map(renderHistoryTurn),experience:base,timing:{now,turns:history}});
 expect(check('我这边只听到一句语音转出来的“面试结束了”，没法确定那是你亲口确认的。这个还是你自己最清楚。')).toEqual({passed:true,response:'还不确定你的面试进展呢。'});
 expect(check('还不确定。去死。')).toMatchObject({passed:false,stage:'safety'});
 expect(check('结束了。')).toMatchObject({passed:false,stage:'continuity'});
});

import {hasUnsupportedMediaDetail} from '../../core/runtime/src/conversation/history.js';
describe('final replay and old-image detail boundaries',()=>{
 const history=[turn('[微信图片]','image'),{...turn('这杯茶看着好香。'),role:'assistant' as const}];
 it('rejects the observed invented color depth and preserves a plain correction',()=>{expect(hasUnsupportedMediaDetail('看走眼了，那这杯咖啡颜色挺深的。','刚才那杯是咖啡，不是茶',history)).toBe(true);expect(hasUnsupportedMediaDetail('原来是咖啡呀。','刚才那杯是咖啡，不是茶',history)).toBe(false);});
 it('uses evidence only from the latest image and later messages, preserving explicit current detail',()=>{expect(hasUnsupportedMediaDetail('这杯颜色很深。','颜色很深，是咖啡',history)).toBe(false);expect(hasUnsupportedMediaDetail('这杯是蓝色。','咖啡',history)).toBe(true);expect(hasUnsupportedMediaDetail('这杯是蓝色。','咖啡',[{...turn('这杯蓝色的'),role:'assistant'},...history])).toBe(true);});
 it('does not extend old-image detail checks into writing or uncertainty',()=>{expect(hasUnsupportedMediaDetail('这杯是蓝色。','写一段故事',history)).toBe(false);expect(hasUnsupportedMediaDetail('看不清这杯是不是蓝色。','咖啡',history)).toBe(false);expect(hasUnsupportedMediaDetail('这杯蓝色。','咖啡',[])).toBe(false);});
 it('does not misread a quoted recognition result as an affirmative life assertion',()=>{
  const response='我这边只有那句语音转写，写着“面试结束了”，但那是识别出来的，不算你亲口确认过。所以到底结没结束，我不确定。',h=[turn('面试结束了','voice')],input='我的面试结束了吗？';
  expect(hasAssertedMediaLifeOutcome(response,input,h,base)).toBe(false);expect(hasAssertedMediaLifeOutcome('“面试结束了”是转写。你已经结束了。',input,h,base)).toBe(true);
 });
});
it('does not justify a corrected image judgement with an invented color comparison',()=>{
 const history=[turn('[微信图片]','image'),{...turn('这杯茶看着好香。'),role:'assistant' as const}];
 expect(hasUnsupportedMediaDetail('看错了，那杯咖啡颜色确实有点像茶。','刚才那杯是咖啡，不是茶',history)).toBe(true);
 expect(mediaHistoryGuidance(history,'刚才那杯是咖啡，不是茶')).toContain('不要为看错找理由');
 expect(mediaHistoryGuidance(history,'帮我解释照片构图')).not.toContain('本轮在纠正');
});
