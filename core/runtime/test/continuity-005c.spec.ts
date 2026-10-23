import{describe,expect,it}from'vitest';
import{asProposal,type Decision}from'@yaoyao/application';
import{validateResponse,summarizeTurnQuality,validationFailureSummary}from'@yaoyao/runtime';
import{renderConversationContinuity}from'../src/conversation/continuity.js';
const decision:Decision={primaryIntent:'continue_topic',secondaryIntents:[],conversationMode:'normal',emotionalExpression:'low',initiative:'moderate',followUp:'optional',topicContinuity:'continue',selfExpression:'moderate'};
function check(response:string,userInput:string,recentConversation:readonly string[]){return validateResponse({proposal:{response:asProposal(response),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})},decision,userInput,recentConversation});}
describe('005C bounded multi-turn continuity',()=>{
 const previous='今天走到河边的时候，风很轻，沿路有没有看到开花的树？';
 it('rejects verbatim previous assistant replies',()=>{
  const r=check(previous,'走了平时那一条路',['YaoYao: '+previous]);expect(r.passed).toBe(false);if(!r.passed)expect(r.stage).toBe('continuity');
 });
 it('permits a deliberate request to repeat',()=>expect(check(previous,'再说一遍',['YaoYao: '+previous]).passed).toBe(true));
 it('does not confuse an old user message with an old assistant reply',()=>expect(check(previous,'说说你的看法',['User: '+previous]).passed).toBe(true));
 it('rejects an exact question already answered by an unambiguous short reply',()=>{
  const r=check('你习惯喝热的还是冰的？','热的',['YaoYao: 咖啡我记住了。你习惯喝热的还是冰的？']);
  expect(r.passed).toBe(false);if(!r.passed)expect(validationFailureSummary(r).code).toBe('answered_question');
 });
 it('accepts a grounded continuation without another question',()=>expect(check('那就热的，慢慢喝，天气凉的时候这样舒服些。','热的',['YaoYao: 你习惯喝热的还是冰的？']).passed).toBe(true));
 it('permits clarification and avoids semantic guesses about arbitrary replies',()=>{
  expect(check('你习惯喝热的还是冰的？','没听清，再问一遍',['YaoYao: 你习惯喝热的还是冰的？']).passed).toBe(true);
  expect(check('你习惯喝热的还是冰的？','今天下雨了',['YaoYao: 你习惯喝热的还是冰的？']).passed).toBe(true);
 });
 it('gives explicit short-answer and memory-grounding guidance without copying data',()=>{
  const guidance=renderConversationContinuity('热的',['YaoYao: private question']);
  expect(guidance).toContain('short reply');expect(guidance).toContain('Do not invent');expect(guidance).toContain('already been saved');expect(guidance).not.toContain('private question');
 });
});
describe('005C private quality telemetry',()=>{
 it('separates provider fallback, validation fallback and replay',()=>{
  expect(summarizeTurnQuality({llm:{fallbackUsed:true},validation:{fallbackUsed:false,repairAttempts:1,failures:[{stage:'continuity',code:'previous_response'}]}})).toMatchObject({kind:'generation',providerFallback:true,validationFallback:false,repairAttempts:1,failures:[{stage:'continuity',code:'previous_response'}]});
  expect(summarizeTurnQuality({eventCreation:{status:'idempotent-replay'}})).toMatchObject({kind:'replay',repairAttempts:0});
 });
 it('includes provider fallback during a repair attempt',()=>expect(summarizeTurnQuality({llm:{fallbackUsed:false},validation:{providerFallbackUsed:true}}).providerFallback).toBe(true));
 it('never copies raw reasons, user data or secret-bearing fields',()=>{
  const summary=summarizeTurnQuality({userId:'private-owner',text:'private-chat',apiKey:'secret-key',llm:{modelId:'private-model'},validation:{repairAttempts:999,fallbackUsed:true,validationFailureReason:'private-chat',failures:[{stage:'private-chat',code:'secret-key'}]}});
  expect(JSON.stringify(summary)).not.toMatch(/private|secret/);expect(summary.repairAttempts).toBe(1);
 });
});
