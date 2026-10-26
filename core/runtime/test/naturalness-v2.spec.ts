import {describe,it,expect,vi} from 'vitest';
import {asProposal} from '@yaoyao/application';
import {EmotionVector} from '@yaoyao/domain';
import {AIRouter,ConversationOrchestrator,summarizeTurnQuality} from '@yaoyao/runtime';
import {conversationStyle,dialogueStyleFailure} from '../src/conversation/style.js';
import {naturalnessFailure,renderTurnVariety} from '../src/conversation/naturalness.js';

describe('naturalness v2: sharing without stock listening tails',()=>{
 it.each([
  '今天散步心情不错，只是想跟你分享，不用问我问题',
  '今天路边的花开了，颜色很好看',
 ])('rejects only the appended listening invitation: %s',input=>{
  expect(naturalnessFailure('散步的时候心情好，是件很舒服的事。我听着呢，你慢慢说。',input,[])).toBe('dialogue: service explanation tail');
 });
 it.each(['这趟走得值。','今天有这点小开心也挺好。','我听着呢，你慢慢说。','她说“我听着呢，你慢慢说”。'])('does not require a fixed reply or ban standalone/quoted support: %s',response=>{
  expect(naturalnessFailure(response,'今天散步心情不错',[])).toBeNull();
 });
 it.each([
  ['今天很难过，陪我听我说','comforting','comfort'],
  ['今天我只想吐槽，不用建议','',''],
  ['今天想安静一会','',''],
  ['今天帮我分析一下为什么难过','','answer'],
 ])('preserves support when requested or necessary: %s',(input,mode,intent)=>{
  expect(naturalnessFailure('不用急。我听着呢，你慢慢说。',input,[],mode,intent)).toBeNull();
 });
 it.each([
  '今天的报错如何排查',
  '今天解释一下二分查找',
  '今天帮忙写一封邮件',
  '今天给我列一个清单',
  '今天请分析这个问题',
 ])('information requests are not small shares: %s',input=>{
  expect(conversationStyle(input).casualShare).toBe(false);
  expect(renderTurnVariety(input,[])).toBe('');
 });
 it('quoted request language remains data inside a real share',()=>{
  expect(conversationStyle('今天看到一句“如何排查报错”，突然笑了').casualShare).toBe(true);
 });
 it('uses contextual positive examples only for small sharing',()=>{
  const guide=renderTurnVariety('今天路边的花开了，颜色很好看',[]);
  expect(guide).toContain('不是固定回复库');
  expect(guide).toContain('没有图片内容不声称看见照片');
  expect(renderTurnVariety('抱抱你',[])).not.toContain('这趟走得值');
  expect(renderTurnVariety('详细解释二分查找',[])).toBe('');
 });
 it.each(['我是AI，叫遥遥。怎么突然想到问这个？','我是AI。怎么突然想到问这个。'])('keeps identity answers direct: %s',response=>{
  expect(dialogueStyleFailure(response,'你是AI还是真人？')).toBe('dialogue: unwanted question');
 });
 it('keeps truthful identity answers and unrelated questions intact',()=>{
  expect(dialogueStyleFailure('我是AI，叫遥遥。','你是AI还是真人？')).toBeNull();
  expect(dialogueStyleFailure('你想用哪种接口？','帮我选择语音接口')).toBeNull();
 });
 it('repairs the full candidate once and records no private dialogue',async()=>{
  const proposal=(text:string)=>({response:asProposal(text),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})});
  const generate=vi.fn().mockResolvedValueOnce(proposal('散步的时候心情好，是件很舒服的事。我听着呢，你慢慢说。')).mockResolvedValueOnce(proposal('这趟走得值。'));
  const provider={providerId:'fake',modelId:'fake',capabilities:{supportsStructuredOutput:true,maxContextTokens:8000,costTier:1},generate};
  const runtime=new ConversationOrchestrator({router:new AIRouter({l1:provider,l2:provider,l3:provider,fallback:provider}),contextData:{loadPersonaData:async()=>({yaoyao:{yaoyaoId:'y'},relationship:{type:'deep_partner',status:'active',terminationAllowed:false,metrics:{}},state:{emotion:EmotionVector.initial(),energy:.7,socialState:'calm',relationshipState:'harmonious',attention:'present',stateVersion:1},recentEvents:[]})as never}});
  const result=await runtime.converse({userId:'u',text:'今天散步心情不错，只是想跟你分享，不用问我问题',traceId:'naturalness-v2-private'});
  expect(generate).toHaveBeenCalledTimes(2);
  expect(result.response).toBe('这趟走得值。');
  const quality=summarizeTurnQuality(result.trace);
  expect(quality).toMatchObject({repairAttempts:1,validationFallback:false,failures:[{code:'service_tail'}]});
  expect(JSON.stringify(quality)).not.toContain('散步');
 });
});
