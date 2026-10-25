import {dialogueStyleFailure} from '../../core/runtime/src/conversation/style.js';
import {experienceResponseFailure} from '../../core/runtime/src/conversation/experience.js';
import {describe,it,expect} from 'vitest';
import {parseCompanionCommand,isCompanionCommandText,lifeReference,DEFAULT_PREFERENCES} from '@yaoyao/application';
import {naturalnessFailure,renderTurnVariety} from '@yaoyao/runtime';
import {RollingPerformance} from '@yaoyao/infrastructure';
describe('009A/B explicit companion commands',()=>{
 it.each(['设置列表','偏好设置','近况列表','设置帮助','近况帮助','恢复默认设置','设置回复：简短','设置称呼：小雨','设置时区：Asia/Shanghai','设置亲昵：克制','设置追问：少问','设置建议：按需','以后简短一点','以后不要追问了','今后不要给我建议','以后叫我小雨','记录近况：我明天要面试','更新近况 ABCD1234：延期到明天','确认设置 ABC123','取消近况 ABC123'])('routes standalone command without a model: %s',text=>{expect(isCompanionCommandText(text)).toBe(true);});
 it.each(['今天简短一点','这次叫我小雨','他说“以后简短一点”','如果以后叫我小雨会怎样','不要设置回复：简短','我明天要面试','面试结束了','记忆列表','确认 ABC123','发张自拍给我'])('does not silently persist ordinary/current-turn text: %s',text=>expect(parseCompanionCommand(text)).toBeNull());
 it('invalid explicit input stays a command error rather than falling through to the model',()=>{expect(parseCompanionCommand('设置回复：随便')).toEqual({type:'invalid'});expect(parseCompanionCommand('设置称呼：小雨\n设置建议：自然')).toEqual({type:'invalid'});});
 it('uses random suffix for stable owner-visible references',()=>{expect(lifeReference('00112233-4455-6677-8899-aabbccddeeff')).toBe('CCDDEEFF');});
});
describe('009C naturalness boundaries',()=>{
 it('repairs mechanical emotion commentary only in casual contexts',()=>{expect(naturalnessFailure('我能感受到你内心的喜悦。','今天买了花',[])).toContain('mechanical');expect(naturalnessFailure('我理解你现在的心情，我们慢慢说。','今天有点难过',[],'comforting','comfort')).toBeNull();});
 it('does not introduce task answer length cuts',()=>expect(naturalnessFailure('希望这些步骤能帮助你。','帮我详细解释这些步骤',[])).toBeNull());
 it('rejects a third repeated substantial opening but allows brief affection and requested repetition',()=>{const recent=['YaoYao: 听你这么说，花很漂亮。','YaoYao: 听你这么说，咖啡不错。'];expect(naturalnessFailure('听你这么说，草莓很好吃。','今天买了草莓',recent)).toContain('repeated opening');expect(naturalnessFailure('好呀，晚安宝贝～','一起睡觉吧',['YaoYao: 好呀，晚安宝贝～','YaoYao: 好呀，晚安宝贝～'])).toBeNull();expect(naturalnessFailure('听你这么说，花很漂亮。','再说一次',recent)).toBeNull();});
 it('blocks service tails in casual shares, not quoted examples',()=>{expect(naturalnessFailure('挺有意思。如果你还有需要，随时告诉我。','今天尝了新口味',[])).toContain('tail');expect(naturalnessFailure('“我能感受到”这句话有点官方。','今天读了句话',[])).toBeNull();});
 it('keeps no more than two bounded opening hints',()=>{const text=renderTurnVariety('今天买了花',Array.from({length:100},(_,i)=>'YaoYao: '+i+'a'.repeat(200)));expect(text.length).toBeLessThan(300);expect(text).not.toContain('a'.repeat(25));});
});
describe('009D bounded aggregate telemetry',()=>{
 it('drops unknown fields and excludes replay from generation usage/latency',()=>{let now=0;const r=new RollingPerformance(2,900000,()=>now);expect(r.record({kind:'generation',totalMs:500,knownProviderAttempts:2,successfulInputTokens:100,text:'private',key:'secret'},'weixin')).toBeNull();now=100;const report=r.record({kind:'replay',totalMs:4,knownProviderAttempts:100,successfulInputTokens:999},'web')!;expect(report.generation).toBe(1);expect(report.replay).toBe(1);expect(report.knownProviderAttempts).toBe(2);expect(report.successfulInputTokens).toBe(100);expect(report.meanGenerationMs).toBe(500);expect(JSON.stringify(report)).not.toMatch(/private|secret|999/);});
 it('reports a p95 upper bound, resets on elapsed window and clamps hostile numbers',()=>{let now=0;const r=new RollingPerformance(1,1000,()=>now);r.record({kind:'generation',totalMs:600,successfulOutputTokens:Infinity},'weixin');expect(r.snapshot().p95UpperMs).toBe(1000);now=1001;r.record({kind:'generation',totalMs:100,knownProviderAttempts:-4},'web');expect(r.snapshot().generation).toBe(1);expect(r.snapshot().knownProviderAttempts).toBe(0);});
 it('emits failure metadata promptly and rejects invalid modes',()=>{const r=new RollingPerformance();expect(r.record({kind:'generation',failedInvocations:1},'weixin')).toBeTruthy();expect(r.record({kind:'not-real',text:'private'},'web')).toBeNull();expect(()=>new RollingPerformance(0)).toThrow();});
});

describe('009 observed live candidate corrections',()=>{
 it('rejects invented between-message thoughts while preserving fiction and current chat',()=>{expect(dialogueStyleFailure('刚在发呆，脑子里转着点事。','你刚才在干嘛')).toContain('invented offline');expect(dialogueStyleFailure('我刚才在心里念着你。','我想你了')).toContain('invented offline');expect(dialogueStyleFailure('倒像是我该汇报点什么似的。','你刚才在干嘛')).toContain('accountability taunt');expect(dialogueStyleFailure('在和你聊天呀。','你刚才在干嘛')).toBeNull();expect(dialogueStyleFailure('刚在发呆，脑子里转着事。','写一段对白')).toBeNull();expect(dialogueStyleFailure('“刚在发呆”是他写的。','今天读了一句话')).toBeNull();});
 it('rejects indirect binary probes under minimal questions, allows an explicit request or natural-question setting',()=>{const context={preferences:{...DEFAULT_PREFERENCES},lifeEvents:[]};const reply='第一口是惊喜还是踩雷，我挺好奇你的判断。';expect(experienceResponseFailure(reply,'今天尝了新口味的咖啡',context,'','')).toContain('unwanted followup');expect(experienceResponseFailure(reply,'帮我写一句问咖啡口味的话',context,'','')).toBeNull();expect(experienceResponseFailure(reply,'今天尝了新口味的咖啡',{...context,preferences:{...context.preferences,questions:'natural'}},'','')).toBeNull();});
});
