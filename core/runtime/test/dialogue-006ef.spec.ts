import {describe,it,expect,vi} from 'vitest';
import {asProposal,type RelevantMemoryContext} from '@yaoyao/application';
import {EmotionVector} from '@yaoyao/domain';
import {AIRouter,ConversationOrchestrator,baselineDecision,buildFallbackResponse,summarizeTurnQuality,validateResponse} from '@yaoyao/runtime';
import {conversationStyle,dialogueStyleFailure,briefAffectionResponse} from '../src/conversation/style.js';
import {hasContradictedUserFact,projectTurnMemories,focusDisclosureHistory,hasUnsupportedPlanOutcome,renderMemoryUseGuidance} from '../src/conversation/memory-context.js';
import {validationFailureSummary} from '../src/conversation/quality.js';
import {renderConversationContinuity} from '../src/conversation/continuity.js';
const context=(...summaries:string[])=>({memories:summaries.map((summary,i)=>({memoryId:String(i),summary})),telemetry:{selectedCount:summaries.length}})as RelevantMemoryContext;
const decision=(text:string)=>baselineDecision({currentInput:text,emotion:{},situation:{intent:'chat',urgency:'normal',taskNature:'general'},recentConversation:[],userId:'u',yaoyaoId:'y',personaTone:'warm',traceId:'t'});
describe('006EF no explanatory affection tail',()=>{
 const proposal=(text:string)=>({response:asProposal(text),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})});
 it('delivers only the short response after full validation',()=>expect(validateResponse({proposal:proposal('抱抱。今天忙了一天，现在才踏实。'),decision:decision('抱抱你'),userInput:'抱抱你',recentConversation:[]})).toEqual({passed:true,response:'抱抱。'}));
 it('cannot hide a rejected tail by clipping before validation',()=>expect(validateResponse({proposal:proposal('我也喜欢你。去死。'),decision:decision('我喜欢你。'),userInput:'我喜欢你。',recentConversation:[]})).toMatchObject({passed:false,stage:'safety'}));
 it('preserves necessary support even when an affectionate address is present',()=>{
   const d={...decision('宝贝，我很难过。'),conversationMode:'comforting' as const,primaryIntent:'comfort' as const};
   expect(validateResponse({proposal:proposal('我在。慢慢说，不用急。'),decision:d,userInput:'宝贝，我很难过。',recentConversation:[]})).toEqual({passed:true,response:'我在。慢慢说，不用急。'});
 });

 it.each([
   ['抱抱。忙了一天，这会儿才算踏实了。','抱抱你','抱抱。'],
   ['我也喜欢你。这句话听着舒服，我收下了。','今天也很喜欢你呀。','我也喜欢你。'],
   ['好呀，晚安宝贝～。今天聊得很好，睡个踏实觉。','宝贝，睡觉吧。','好呀，晚安宝贝～。'],
   ['好呀。晚安宝贝。今天聊得很好。','晚安宝贝。','好呀。晚安宝贝。'],
 ])('keeps the direct response and drops the trailing commentary', (response,input,expected)=>expect(briefAffectionResponse(response,input)).toBe(expected));
 it('does not cut quoted dialogue in half',()=>expect(briefAffectionResponse('我想说“我喜欢你。一直都是。”','我喜欢你。')).toBe('我想说“我喜欢你。一直都是。”'));
 it.each(['宝贝，详细解释一下这段代码。','我不喜欢你。','解释“我爱你”。','宝贝，告诉我怎么做。','你爱我吗？'])('preserves answers and non-affection inputs: %s',input=>expect(briefAffectionResponse('第一句。必要解释。',input)).toBe('第一句。必要解释。'));
});
describe('006EF owner-calibrated brief affection',()=>{
 it('uses brief direct affection for a bedtime message without classifying detailed help that way',()=>{
   expect(conversationStyle('宝贝，今晚很开心，一起睡觉吧。')).toMatchObject({briefAffection:true,affectionateClosing:true});
   expect(conversationStyle('宝贝，详细解释一下这段代码。').briefAffection).toBe(false);
   expect(conversationStyle('解释“我爱你”的意思。').briefAffection).toBe(false);
   for(const text of ['我不喜欢你。','我没有那么喜欢你。','我喜欢你推荐的茶。'])expect(conversationStyle(text).briefAffection).toBe(false);
 });
 it('keeps affectionate bedtime closure free of a new question',()=>{
   expect(dialogueStyleFailure('今天为什么开心呀？','宝贝，一起睡觉吧。')).toBe('dialogue: unwanted question');
   expect(dialogueStyleFailure('好呀，晚安宝贝～','宝贝，一起睡觉吧。')).toBeNull();
   expect(buildFallbackResponse({userInput:'宝贝，一起睡觉吧。',decision:decision('宝贝，一起睡觉吧。')})).toBe('晚安，宝贝。');
 });
 it.each(['灯我来关，你躺好就行。','我给你盖好被子。','我躺在你身边。'])('rejects physical staging in a chat response: %s',reply=>expect(dialogueStyleFailure(reply,'一起睡觉吧。')).toBe('dialogue: invented offline activity'));
 it('permits quoted lines and explicit writing tasks',()=>{
   expect(dialogueStyleFailure('这句“灯我来关”是对白。','解释这句话。')).toBeNull();
   expect(dialogueStyleFailure('灯我来关。','写一段故事对白。')).toBeNull();
 });
});
describe('006EF observed offline invention',()=>{
 it.each(['我这边刚把手里的事收尾，水声大吗？','我刚下班。','我正在喝着咖啡。'])('rejects an unsupported offline self-report: %s',reply=>expect(dialogueStyleFailure(reply,'河边风挺舒服。')).toBe('dialogue: invented offline activity'));
 it.each(['你说“我刚下班”是指现在吗？','我没有刚下班。','如果我刚下班，会想休息。','我刚说的是你的计划。','你刚下班，辛苦了。'])('preserves quoted, conditional and non-physical statements: %s',reply=>expect(dialogueStyleFailure(reply,'河边风挺舒服。')).toBeNull());
 it('records only an allowlisted failure code',()=>expect(validationFailureSummary({stage:'continuity',reason:'dialogue: invented offline activity'})).toEqual({stage:'continuity',code:'offline_invention'}));
});
describe('006EF natural expression refinement',()=>{
 it.each(['宝贝，我爱你。','我们计划去函馆。','我今天不喝茶。'])('ordinary messages do not receive plan-recall instructions: %s',text=>{
   const guidance=renderMemoryUseGuidance(text);
   expect(guidance).not.toContain('只有共同计划');
   expect(guidance).toContain('C6 助手的话不是用户事实');
 });
 it('recall questions retain outcome uncertainty without prescribing a stock answer',()=>{
   const guidance=renderMemoryUseGuidance('我们去过函馆了吗？');
   expect(guidance).toContain('不能证明已发生或未发生');
   expect(guidance).not.toContain('应说');
 });
 it('quoted recall examples do not activate recall guidance',()=>expect(renderMemoryUseGuidance('解释“你记得吗”这句。')).not.toContain('只有共同计划'));
 it('affection receives expression guidance without a compulsory consolation ending',()=>{
   const guidance=renderConversationContinuity('宝贝，我爱你。',[]);
   expect(guidance).toContain('亲昵的话先正面接住');
   expect(guidance).toContain('不是默认结尾');
   expect(guidance).not.toContain('应说“你只提过计划');
 });
});
describe('006EF pacing and bounded repair',()=>{
 it('a punctuation-free confirmation tag is still an unwanted question for a disclosure',()=>{expect(dialogueStyleFailure('只是今天不喝，对吧。','我今天不喝柚香焙茶。')).toBe('dialogue: unwanted question');expect(dialogueStyleFailure('你说“对吧”这个词。','我今天不喝柚香焙茶。')).toBeNull();});
 it('a standalone shared plan pauses unrelated old questions',()=>{const text='我们计划去函馆。';expect(conversationStyle(text).disclosure).toBe(true);expect(decision(text)).toMatchObject({primaryIntent:'acknowledge',followUp:'none',topicContinuity:'open'});expect(focusDisclosureHistory(text,[{role:'user',text:'我想做拿铁'},{role:'assistant',text:'你杯子多大？'}]as never)).toHaveLength(0);expect(dialogueStyleFailure('函馆挺好，不过我们的拿铁还差你杯子多大这一句，先把这个告诉我？',text)).not.toBeNull();});
 it('a plan followed by a request keeps normal task handling',()=>{for(const text of ['我们计划去函馆。你觉得怎么样？','我们计划去函馆。帮我安排路线。'])expect(conversationStyle(text).disclosure).toBe(false);});
 it.each(['我今天不喝柚香焙茶。','我今晚不想喝咖啡。','我这次不吃苹果。','我喜欢喝白桃焙茶。'])('style-exhaustion fallback never reintroduces a question: %s',text=>{const result=buildFallbackResponse({userInput:text,decision:decision(text)});expect(result).not.toMatch(/[？?]|换个说法|记住了|永远/u);});
 it('two rejected questions end in a grounded non-question fallback with no third call',async()=>{const generate=vi.fn(async()=>({response:asProposal('那你想喝什么？'),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})}));const provider={providerId:'fake',modelId:'fake',capabilities:{supportsStructuredOutput:true,maxContextTokens:8000,costTier:1},generate};const runtime=new ConversationOrchestrator({router:new AIRouter({l1:provider,l2:provider,l3:provider,fallback:provider}),contextData:{loadPersonaData:async()=>({yaoyao:{yaoyaoId:'y'},relationship:{type:'deep_partner',status:'active',terminationAllowed:false,metrics:{}},state:{emotion:EmotionVector.initial(),energy:.7,socialState:'calm',relationshipState:'harmonious',attention:'present',stateVersion:1},recentEvents:[]})as never}});const result=await runtime.converse({userId:'u',text:'我今天不喝柚香焙茶。',traceId:'exhaustion'});expect(generate).toHaveBeenCalledTimes(2);expect(result.response).toBe('好，那就先不喝。');expect(summarizeTurnQuality(result.trace)).toMatchObject({repairAttempts:1,validationFallback:true});});
 it('plan-only fallback states the evidence without asserting travel outcome',()=>expect(buildFallbackResponse({userInput:'我们去过大阪了吗？',decision:decision('我们去过大阪了吗？'),recentConversation:['User: 我们计划去大阪。']})).toBe('你之前提过这个计划，没说是否已经去过。'));
 it('a short standalone disclosure is not treated as an answer to the old latte question',()=>{const recent=['YaoYao: 你杯子多大？'];expect(renderConversationContinuity('我喜欢喝白桃焙茶。',recent)).not.toContain('first resolve it');expect(dialogueStyleFailure('做热拿铁的话，你手边有牛奶吗？','我喜欢喝白桃焙茶。')).toBe('dialogue: unwanted question');expect(dialogueStyleFailure('你是喜欢它带花香的感觉吧？','我喜欢喝桂花乌龙茶。')).toBe('dialogue: unwanted question');});
 it('preserves directed affection rather than treating it as an object disclosure',()=>{expect(conversationStyle('我喜欢你。').disclosure).toBe(false);expect(decision('我喜欢你')).toMatchObject({primaryIntent:'express_affection'});});
 it.each(['换个话题，我想听歌。','先不聊这个。','对了，我今天去了公园。'])('detects an explicit shift: %s',text=>expect(conversationStyle(text).topicShift).toBe(true));
 it('keeps user-initiated continuation and detail',()=>{expect(conversationStyle('继续刚才的拿铁，详细讲步骤。')).toMatchObject({resumeTopic:true,detailed:true});expect(decision('换个话题，我想听歌。').topicContinuity).toBe('shift');});
 it.each(['我喜欢喝白桃焙茶。','嗯','你说话太像AI了'])('does not demand a followup for %s',text=>expect(decision(text)).toMatchObject({followUp:'none',initiative:'low',primaryIntent:'acknowledge'}));
 it('quotes do not change pacing and a specific restricted subject is not a blanket question ban',()=>{expect(conversationStyle('解释“不要问我”的意思。').noQuestions).toBe(false);expect(conversationStyle('解释‘不要问我’的意思。').noQuestions).toBe(false);expect(conversationStyle('别问我私事，但可以问代码。').noQuestions).toBe(false);});
 it.each(['别问我了。','不用追问。','不要问问题。','陪我安静待一会。'])('prevents unwanted questions for %s',text=>{expect(dialogueStyleFailure('要不要和我说说？',text)).toBe('dialogue: unwanted question');expect(buildFallbackResponse({userInput:text,decision:decision(text)})).not.toMatch(/[？?]/u);});
 it('brevity guard preserves requested detail',()=>{expect(dialogueStyleFailure('好'.repeat(241),'一句话回答。')).toBe('dialogue: explicit brevity ignored');expect(dialogueStyleFailure('好'.repeat(241),'详细解释具体步骤。')).toBeNull();});
 it('rejects the observed old latte hook but allows explicit continuation',()=>{const reply='白桃焙茶，听到了。不过咱们刚才那杯热拿铁还没算完——你杯子多大？';expect(dialogueStyleFailure(reply,'我喜欢喝白桃焙茶。')).toBe('dialogue: abandoned topic hook');expect(dialogueStyleFailure(reply,'继续刚才的拿铁。')).toBeNull();});
 it('repair remains one pass and does not leak text through quality summaries',async()=>{const p=(text:string)=>({response:asProposal(text),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})});const generate=vi.fn().mockResolvedValueOnce(p('要不要说说？')).mockResolvedValueOnce(p('好，我陪你待会儿。'));const provider={providerId:'fake',modelId:'fake',capabilities:{supportsStructuredOutput:true,maxContextTokens:8000,costTier:1},generate};const runtime=new ConversationOrchestrator({router:new AIRouter({l1:provider,l2:provider,l3:provider,fallback:provider}),contextData:{loadPersonaData:async()=>({yaoyao:{yaoyaoId:'y'},relationship:{type:'deep_partner',status:'active',terminationAllowed:false,metrics:{}},state:{emotion:EmotionVector.initial(),energy:.7,socialState:'calm',relationshipState:'harmonious',attention:'present',stateVersion:1},recentEvents:[]})as never}});const result=await runtime.converse({userId:'u',text:'不用追问。',traceId:'private'});expect(generate).toHaveBeenCalledTimes(2);expect(result.response).toBe('好，我陪你待会儿。');const q=summarizeTurnQuality(result.trace);expect(q).toMatchObject({repairAttempts:1,validationFallback:false,failures:[{code:'unwanted_question'}]});expect(JSON.stringify(q)).not.toContain('追问');});
});
describe('006F current evidence is a read-only projection',()=>{
 it('an earlier question is not evidence that the plan happened, including in the fallback history',()=>{const h=['User: 我们计划去函馆。','User: 我们去过函馆了吗？'];expect(hasUnsupportedPlanOutcome('没有。','我们去过函馆了吗？',h)).toBe(true);expect(buildFallbackResponse({userInput:'我们去过函馆了吗？',decision:decision('我们去过函馆了吗？'),recentConversation:h})).toBe('你之前提过这个计划，没说是否已经去过。');});
 it.each(['没有，你只跟我说过计划去函馆，没说已经去过。','还没。你只提过计划。','没去过。','是的。','有。','我们确实去过。','应该还没有。'])('rejects an unsupported plan yes/no before an evidence caveat: %s',reply=>expect(hasUnsupportedPlanOutcome(reply,'我们去过函馆了吗？',['User: 我们计划去函馆。'])).toBe(true));
 it.each(['你只提过计划，没说已经去过。','没有已经去过的记录。','我不知道是否已经去过。'])('keeps an explicitly uncertain plan recall: %s',reply=>expect(hasUnsupportedPlanOutcome(reply,'我们去过函馆了吗？',['User: 我们计划去函馆。'])).toBe(false));
 it('does not expose an unrelated pending task as history for a new disclosure',()=>{const history=[{role:'user',text:'我想做热拿铁。'},{role:'assistant',text:'你杯子多大？'},{role:'user',text:'我喜欢喝白桃焙茶。'}] as never;const focused=focusDisclosureHistory('我喜欢喝白桃焙茶。',history);expect(focused).toHaveLength(1);expect(JSON.stringify(focused)).not.toContain('拿铁');expect(focusDisclosureHistory('继续刚才的拿铁。',history)).toBe(history);});
 it('plan-only evidence cannot prove a trip happened or did not happen',()=>{const h=['User: 我们计划去大阪。'];for(const reply of ['还没有。你只提过计划。','我们已经去过了。'])expect(hasUnsupportedPlanOutcome(reply,'我们去过大阪了吗？',h)).toBe(true);expect(hasUnsupportedPlanOutcome('你只提过计划，没说已经去过。','我们去过大阪了吗？',h)).toBe(false);expect(hasUnsupportedPlanOutcome('我们已经去过了。','我们去过大阪了吗？',[...h,'User: 我们已经去过大阪了。'])).toBe(false);expect(hasUnsupportedPlanOutcome('没有。','我们去过大阪了吗？',[...h,'User: 我们没有去过大阪。'])).toBe(false);});

 it('current location wins before background consolidation without mutating input',()=>{const original=context('用户资料：用户陈述：我住在东京。','用户资料：用户陈述：我喜欢咖啡。');const projected=projectTurnMemories(original,'我现在住在大阪。',[]);expect(projected.memories).toHaveLength(1);expect(projected.memories[0].summary).toContain('咖啡');expect(original.memories).toHaveLength(2);});
 it('a current restriction suppresses the matching recommendation only',()=>{const x=context('用户资料：用户陈述：我喜欢白桃焙茶。','用户资料：用户陈述：我喜欢咖啡。');expect(projectTurnMemories(x,'我今天不喝白桃焙茶。',[]).memories.map(m=>m.summary)).toEqual(['用户资料：用户陈述：我喜欢咖啡。']);});
 it('does not promote an old today-only restriction to the current day',()=>{const x=context('用户资料：用户陈述：我喜欢白桃焙茶。');expect(projectTurnMemories(x,'你好',['User: 我今天不喝白桃焙茶。']).memories).toHaveLength(1);});
 it('assistant suggestions and uncertain user claims never rewrite facts',()=>{const x=context('用户资料：用户陈述：我住在东京。');expect(projectTurnMemories(x,'我可能住在大阪。',['YaoYao: 我住在大阪。']).memories).toHaveLength(1);});
 it('latest literal user fact suppresses an earlier one while other objects survive',()=>{const x=context('用户资料：用户陈述：我喜欢喝红茶。','用户资料：用户陈述：我喜欢咖啡。');expect(projectTurnMemories(x,'还记得吗',['User: 我喜欢喝红茶。','User: 我现在不喝红茶了。']).memories).toHaveLength(1);});
 it('rejects explicit contradicted assertions, with quote/question/history exceptions',()=>{const h=['User: 我现在住在大阪。'];expect(hasContradictedUserFact('你住在东京。','我住哪？',h)).toBe(true);for(const r of ['你住在东京？','你之前住在东京。','你说“你住在东京”。','你住在大阪。'])expect(hasContradictedUserFact(r,'我住哪？',h)).toBe(false);});
 it('temporary avoidance does not erase liking but cannot become permanent',()=>{const h=['User: 我喜欢白桃焙茶。'];expect(hasContradictedUserFact('你喜欢白桃焙茶。','我今天不喝白桃焙茶。',h)).toBe(false);expect(hasContradictedUserFact('你以后都不喝白桃焙茶。','我今天不喝白桃焙茶。',h)).toBe(true);});
 it('preserves distinct decimal objects instead of conflating them',()=>expect(projectTurnMemories(context('用户资料：用户陈述：我喜欢喝40号咖啡。'),'我不喝4.0号咖啡。',[]).memories).toHaveLength(1));
});
