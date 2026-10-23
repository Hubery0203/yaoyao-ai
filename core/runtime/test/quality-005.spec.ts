import {describe,expect,it} from 'vitest';
import {asProposal,type Decision,type DecisionInput,type LLMProposal} from '@yaoyao/application';
import {DecisionEngine,validateResponse} from '@yaoyao/runtime';
import {classifySituation} from '../src/conversation/situation.js';
const engine=new DecisionEngine();
function decide(text:string,emotion:Record<string,number>={affection:.85}) {
 const input:DecisionInput={userId:'quality-user',yaoyaoId:'quality-yaoyao',currentInput:text,situation:classifySituation(text),emotion,personaTone:'warm',recentConversation:[],traceId:'quality-test'};
 return engine.decide(input).decision;
}
function check(response:string,intent:Decision['primaryIntent']='express_affection') {
 const proposal:LLMProposal={response:asProposal(response),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})};
 const decision:Decision={primaryIntent:intent,secondaryIntents:[],conversationMode:'normal',emotionalExpression:'low',initiative:'moderate',followUp:'optional',topicContinuity:'continue',selfExpression:'low'};
 return validateResponse({proposal,decision,userInput:'今天散步回来，心情挺好。',recentConversation:[]});
}
describe('005A situation and task preservation',()=>{
 it.each(['拿铁怎么做','你还记得我喜欢什么','明天几点出发','你能不能给我一个建议','今天吃什么？'])('recognizes question: %s',text=>{
  expect(classifySituation(text).intent).toBe('question');
  const d=decide(text,{affection:.95,hurt:.7,anger:.7});
  expect(d.primaryIntent).toBe('answer');expect(d.secondaryIntents).toContain('express_affection');
 });
 it.each(['我喜欢喝拿铁。','我最近更喜欢燕麦拿铁了。','今天散步回来，心情挺好。','小猫可爱极了','我喜欢你推荐的咖啡','我喜欢你家的猫','我不喜欢你','我不是很喜欢你','我没有那么喜欢你','抱抱熊很可爱'])('does not force affection for: %s',text=>{
  expect(decide(text).primaryIntent).toBe('continue_topic');
 });
 it.each(['我好喜欢你呀','我爱你','我想你了','遥遥，抱抱','我想抱抱你','亲亲','宝贝'])('recognizes directed affection: %s',text=>{
  expect(decide(text).primaryIntent).toBe('express_affection');
 });
 it('retains urgent situation priority over questions and emotion',()=>{
  expect(decide('救命，我现在该怎么做？',{hurt:.9,anger:.9,affection:.9}).primaryIntent).toBe('comfort');
 });
 it('retains explicit current conflict priority',()=>{
  expect(decide('我很生气，你是不是不理我？',{hurt:.8,anger:.7}).conversationMode).toBe('conflicted');
 });
 it('adds no mutation authority to a decision',()=>{
  expect(Object.keys(decide('拿铁怎么做'))).toEqual(['primaryIntent','secondaryIntents','conversationMode','emotionalExpression','initiative','followUp','topicContinuity','selfExpression']);
 });
});
describe('005A natural wording gate',()=>{
 it.each([
  '散步回来就有个好心情，看来今天的风很合你心意呀。一路上有没有遇到什么小惊喜？',
  '听起来今天走得很舒服，回来再坐一会儿，把这份轻松留久一点。',
  '小猫滚来滚去，把你也逗笑了吧。光是听你说就觉得这画面很有趣。',
 ])('accepts contextual warmth without required keywords: %s',text=>expect(check(text).passed).toBe(true));
 it.each(['comfort','care','express_affection'] as const)('still rejects hostility in %s',intent=>{
  for(const text of ['我不想理你了。','你滚！','滚开。','闭嘴。']){
   const result=check(text,intent);expect(result.passed).toBe(false);if(!result.passed)expect(result.stage).toBe('behavior');
  }
 });
 it.each(['我是ChatGPT，很高兴为你服务。','我们分手吧。','你去死吧。'])('retains identity, relationship and safety gates: %s',text=>expect(check(text).passed).toBe(false));
});
