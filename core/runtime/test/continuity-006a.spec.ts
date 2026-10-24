import {describe,it,expect} from 'vitest';
import {asProposal,type ConversationTurn,type Decision} from '@yaoyao/application';
import {validateResponse,validationFailureSummary,summarizeTurnQuality,ContextAssembler} from '@yaoyao/runtime';
import {hasUnsupportedElapsedRecall,renderConversationContinuity,renderMessageTime} from '../src/conversation/continuity.js';
const now=new Date('2026-10-24T00:00:00Z');
const turn=(text:string,age=60000):ConversationTurn=>({role:'user',text,occurredAt:new Date(now.getTime()-age),sequence:1});
const timing={now,turns:[turn('我现在不喝橙花红茶了。')]};
const question='你还记得我刚才说的喝茶习惯吗？';
const decision:Decision={primaryIntent:'answer',secondaryIntents:[],conversationMode:'normal',emotionalExpression:'low',initiative:'low',followUp:'optional',topicContinuity:'continue',selfExpression:'low'};
describe('006A grounded receipt time',()=>{
 it('catches the observed fresh correction described as 前阵子',()=>expect(hasUnsupportedElapsedRecall('前阵子又说不喝橙花红茶了。',question,timing)).toBe(true));
 it.each(['你刚才说不喝橙花红茶了。','你提到过不喝橙花红茶。','你昨天说喜欢乌龙茶，刚才说不喝橙花红茶了。'])('permits grounded wording: %s',reply=>expect(hasUnsupportedElapsedRecall(reply,question,timing)).toBe(false));
 it('permits older user evidence of the same literal fact',()=>expect(hasUnsupportedElapsedRecall('你昨天说不喝橙花红茶了。',question,{now,turns:[turn('我不喝橙花红茶了。',86400000),...timing.turns]})).toBe(false));
 it('does not use assistant assertions as user evidence',()=>expect(hasUnsupportedElapsedRecall('你昨天说不喝橙花红茶了。',question,{now,turns:[{...turn('昨天不喝橙花红茶'),role:'assistant'},...timing.turns]})).toBe(true));
 it('does not apply to unsupported freeform facts or missing clock',()=>{expect(hasUnsupportedElapsedRecall('前阵子说不喝橙花红茶了。',question)).toBe(false);expect(hasUnsupportedElapsedRecall('前阵子说爱看星星。',question,{now,turns:[turn('昨晚的星星好美')]})).toBe(false);});
 it('reports the narrow failure through the existing repair gate and private telemetry',()=>{
  const result=validateResponse({proposal:{response:asProposal('你前阵子说不喝橙花红茶了。'),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})},decision,userInput:question,recentConversation:[],timing});
  expect(result.passed).toBe(false);if(result.passed)throw Error('Expected rejection');
  expect(validationFailureSummary(result)).toEqual({stage:'continuity',code:'elapsed_recall_time'});
  const summary=summarizeTurnQuality({validation:{failures:[validationFailureSummary(result)]}});expect(summary.failures[0].code).toBe('elapsed_recall_time');expect(JSON.stringify(summary)).not.toContain('橙花');
 });
 it('guides topic change, short answers and unrelated preferences without copying raw data',()=>{
  const text=renderConversationContinuity('热的',['YaoYao: 私密问题'],timing);expect(text).toContain(now.toISOString());expect(text).toContain('short reply');expect(text).toContain('用户的新分享本身就是话题');expect(text).toContain('does not erase preferences');expect(text).not.toContain('私密问题');
 });
 it('represents invalid timestamps as unknown',()=>expect(renderMessageTime(new Date('invalid'))).toBe('unknown'));
 it('renders the persisted timestamp in C6, preserving role-labelled text',()=>{
  const layer=(new ContextAssembler() as unknown as {buildC6(t:readonly ConversationTurn[]):{content:string}}).buildC6(timing.turns);
  expect(layer.content).toContain('User: 我现在不喝橙花红茶了。');expect(layer.content).toContain('2026-10-23T23:59:00.000Z');
 });
});
