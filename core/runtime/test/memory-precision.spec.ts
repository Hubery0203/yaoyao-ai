import {dialogueStyleFailure} from '../src/conversation/style.js';
import {baselineDecision,buildFallbackResponse,validationFailureSummary} from '@yaoyao/runtime';
import {describe,it,expect} from 'vitest';
import type {RelevantMemoryContext} from '@yaoyao/application';
import {projectTurnMemories,hasContradictedUserFact,hasUnsupportedResidenceRecall,residenceRecallUnknown} from '../src/conversation/memory-context.js';
const base=()=>({memories:[{memoryId:'tea',summary:'用户资料：用户陈述：我喜欢白桃焙茶。'},{memoryId:'coffee',summary:'用户资料：用户陈述：我喜欢咖啡。'}],telemetry:{selectedCount:2}})as RelevantMemoryContext;
describe('temporary memory restrictions remain turn-local',()=>{
 it.each(['今天不喝白桃焙茶。','我这会儿不想喝白桃焙茶。','此刻不喝白桃焙茶。','这一次不喝白桃焙茶。'])('suppresses only the relevant recommendation: %s',input=>{
  const original=base();const projected=projectTurnMemories(original,input,[]);
  expect(projected.memories.map(m=>m.memoryId)).toEqual(['coffee']);
  expect(original.memories).toHaveLength(2);
  expect(hasContradictedUserFact('你以后都不喝白桃焙茶。',input,[])).toBe(true);
 });
 it('does not carry a date-unknown restriction into a later turn',()=>{
  expect(projectTurnMemories(base(),'推荐点喝的',['User: 我这会儿不喝白桃焙茶。']).memories).toHaveLength(2);
 });
 it.each(['她说“今天不喝白桃焙茶”。','如果今天不喝白桃焙茶。','今天不喝白桃焙茶吗？'])('quotes, hypotheticals and questions do not become a restriction: %s',input=>{
  expect(projectTurnMemories(base(),input,[]).memories).toHaveLength(2);
 });
});

describe('residence needs literal owner evidence',()=>{
 it.each(['你住在东京——这是你设置的时区。','东京。','不确定。你住在东京。','没有记录，但是你住在东京。','我不知道，你之前没跟我说过。'])('rejects unsupported residence: %s',response=>{
  expect(hasUnsupportedResidenceRecall(response,'我住哪里？',[])).toBe(true);
 });
 it.each(['我还不确定你住哪里。','没有明确的居住地记录。'])('keeps explicit uncertainty: %s',response=>expect(hasUnsupportedResidenceRecall(response,'我住哪里？',[])).toBe(false));
 it('uses only literal owner evidence, not assistant claims or quoted/questions',()=>{
  expect(residenceRecallUnknown('我住哪里？',['YaoYao: 你住在东京。','User: 我住在东京吗？','User: 她说“我住在东京”。'])).toBe(true);
  expect(hasUnsupportedResidenceRecall('你住在大阪。','我住哪里？',['User: 我现在住在大阪。'])).toBe(false);
  expect(residenceRecallUnknown('帮我介绍东京',[])).toBe(false);
 });
 it('has an uncertainty fallback for this exact recall request',()=>{
  const decision=baselineDecision({currentInput:'我住哪里？',emotion:{},situation:{intent:'chat',urgency:'normal',taskNature:'general'},recentConversation:[],userId:'u',yaoyaoId:'y',personaTone:'warm',traceId:'t'});
  expect(buildFallbackResponse({userInput:'我住哪里？',decision})).toBe('我还不确定你现在住哪里。');
 });
});

it('uses a private allowlisted code for residence evidence failure',()=>{
 expect(validationFailureSummary({stage:'continuity',reason:'continuity: ungrounded residence recall'})).toEqual({stage:'continuity',code:'residence_evidence'});
});
it('rejects confirmation probes even without a question mark after a correction',()=>{
 expect(dialogueStyleFailure('大阪啊，住得还顺心吧。','我现在住在大阪。')).toBe('dialogue: unwanted question');
 expect(dialogueStyleFailure('大阪呀。','我现在住在大阪。')).toBeNull();
});
