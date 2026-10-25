import {experienceResponseFailure} from '../../core/runtime/src/conversation/experience.js';
import {describe,it,expect} from 'vitest';
import {parseOutreachCommand,outreachDue,isOutreachStop,formatMinute,DEFAULT_PREFERENCES} from '@yaoyao/application';
import {naturalnessFailure,renderTurnVariety} from '@yaoyao/runtime';
import {conversationStyle} from '../../core/runtime/src/conversation/style.js';
describe('010B exact Weixin controls',()=>{
 it.each(['主动联系状态','提醒列表','联系帮助','开启主动联系','设置免打扰：22:00-08:00','设置联系时区：Asia/Singapore','设置联系上限：2','设置问候：09:00','设置问候：关闭','添加提醒：明天 09:00 | 带伞','取消提醒 ABCD1234','确认联系 ABCD1234','取消联系 ABCD1234'])('recognizes %s',t=>expect(parseOutreachCommand(t)).not.toBeNull());
 it.each(['他说“开启主动联系”','如果开启主动联系会怎样','不要开启主动联系','明天提醒我带伞','确认设置 ABC123','开启主动联系\n我回来了'])('does not execute ordinary text %s',t=>expect(parseOutreachCommand(t)).toBeNull());
 it.each(['设置免打扰：24:00-08:00','设置免打扰：08:00-08:00','设置联系上限：3','设置联系时区：Bad/Zone','设置问候：09:99','添加提醒：明天 09:00 | ','添加提醒：明天 09:00 | '+ '字'.repeat(121),'取消提醒 nope'])('keeps malformed command out of model %s',t=>expect(parseOutreachCommand(t)?.type).toBe('invalid'));
 it('pause stops outreach without matching quoted/temporary text',()=>{expect(isOutreachStop('暂停主动联系')).toBe(true);expect(isOutreachStop('他说暂停主动联系')).toBe(false);expect(isOutreachStop('不要暂停主动联系')).toBe(false);});
 it('formats minute without server timezone',()=>expect(formatMinute(1320)).toBe('22:00'));
});
describe('010B local wall clock date interpretation',()=>{
 const now=new Date('2026-10-26T00:00:00Z');
 it('uses explicit account zone and receipt day',()=>{expect(outreachDue('明天 09:00','Asia/Singapore',now)?.toISOString()).toBe('2026-10-27T01:00:00.000Z');expect(outreachDue('今天 09:00','Asia/Tokyo',now)).toBeNull();expect(outreachDue('明天 09:00','America/Los_Angeles',now)?.toISOString()).toBe('2026-10-26T16:00:00.000Z');});
 it('rejects nonexistent days, past or too-far times and DST gap/fold',()=>{for(const when of ['2026-02-30 09:00','2026-10-25 09:00','2027-01-01 09:00'])expect(outreachDue(when,'Asia/Tokyo',now)).toBeNull();expect(outreachDue('2026-03-08 02:30','America/New_York',new Date('2026-03-01Z'))).toBeNull();expect(outreachDue('2026-11-01 01:30','America/New_York',now)).toBeNull();expect(outreachDue('2026-11-01 03:30','America/New_York',now)?.toISOString()).toBe('2026-11-01T08:30:00.000Z');});
});
describe('010A short bursts and rejected suggestions',()=>{
 it('recognizes one multi-line ordinary share without treating a help request as casual',()=>{expect(conversationStyle('我今天终于下班了\n累死了').casualShare).toBe(true);expect(renderTurnVariety('我今天终于下班了\n累死了',[])).toContain('连续短消息');expect(conversationStyle('我今天下班了\n帮我详细解释二分查找').casualShare).toBe(false);});
 it('rejects whole burst echo, allows requested quote and nonidentical reply',()=>{const text='我今天终于下班了\n累死了';expect(naturalnessFailure(text,text,[])).toContain('burst echo');expect(naturalnessFailure(text,'原话重复：'+text,[])).toBeNull();expect(naturalnessFailure('总算忙完了。',text,[])).toBeNull();});
 it('does not reoffer a literal rejected suggestion, keeps negation and writing intact',()=>{expect(naturalnessFailure('要不喝一杯奶茶。','别再推荐奶茶了',[])).toContain('revoked suggestion');expect(naturalnessFailure('好，不推荐奶茶了。','别再推荐奶茶了',[])).toBeNull();expect(naturalnessFailure('推荐奶茶。','如果别再推荐奶茶了会怎样',[])).toBeNull();expect(naturalnessFailure('推荐奶茶。','为什么别再推荐奶茶了？',[],'','answer')).toBeNull();expect(naturalnessFailure('推荐咖啡。','别再推荐奶茶了',[])).toBeNull();expect(naturalnessFailure('推荐奶茶。','写一段对白：别再推荐奶茶了',[])).toBeNull();});
});

describe('010 observed candidate corrections',()=>{
 const context={preferences:{...DEFAULT_PREFERENCES},lifeEvents:[]};
 it('keeps last share after a topic-shift line casual',()=>expect(conversationStyle('换个话题\n今天买了草莓').casualShare).toBe(true));
 it('finishes a grounded short choice without reopening another preference question',()=>{expect(experienceResponseFailure('茶好，想喝哪种？','茶吧',context,'','continue_topic',['YaoYao: 咖啡还是茶？'])).toContain('followup');expect(experienceResponseFailure('你指的是哪件事？','那个',context,'','continue_topic',['YaoYao: 咖啡还是茶？'])).toBeNull();});
 it('stops questions after refusal and distinguishes support from casual life advice',()=>{expect(experienceResponseFailure('那你想喝什么，都随你。','别再推荐奶茶了',context,'','')).toContain('followup');expect(experienceResponseFailure('先缓一缓吧。','面试结束了',context,'','')).toContain('advice');expect(experienceResponseFailure('先休息一下。','我受伤了怎么办',context,'serious','care')).toBeNull();});
});

describe('010 review false-positive and guidance consistency',()=>{
 const context={preferences:{...DEFAULT_PREFERENCES},lifeEvents:[]};
 it('allows a declarative free choice but rejects an actual question',()=>{expect(experienceResponseFailure('好，不推了。想喝什么由你定。','别再推荐奶茶了',context,'','')).toBeNull();expect(experienceResponseFailure('想喝什么你自己定，我就不念叨了。','别再推荐奶茶了',context,'','')).toBeNull();expect(experienceResponseFailure('那你想喝什么？','别再推荐奶茶了',context,'','')).toContain('followup');});
 it('blocks rest-advice preambles before a technical answer, preserves requested rest advice',()=>{expect(naturalnessFailure('下班了就先松口气。二分查找要求有序。','我今天下班了\n帮我详细解释二分查找',[],'','answer')).toContain('advice');expect(naturalnessFailure('先休息，再观察。','帮我详细解释怎么休息',[],'','answer')).toBeNull();});
 it('does not attach a rest assignment to a completed share',()=>expect(experienceResponseFailure('先让自己松口气。','面试结束了',context,'','')).toContain('advice'));
});
