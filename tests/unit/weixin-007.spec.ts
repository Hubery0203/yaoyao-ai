import {describe,it,expect,vi} from 'vitest';
import {batchIsReady,DEFAULT_OUTREACH,isQuietMinute,isOutreachStop,isReplyCancellation,localOutreachClock,validateOutreachSettings} from '@yaoyao/application';
import {processWeixinMessage} from '../../apps/api/src/weixin-bridge.service.js';
import type {WeixinRow} from '@yaoyao/infrastructure';
const settings={...DEFAULT_OUTREACH};
describe('007C/D personal pacing policy',()=>{
 it('defaults off with a quiet interval and one-message cap',()=>{expect(settings.enabled).toBe(false);expect(settings.greeting).toBe(false);expect(settings.dailyLimit).toBe(1);expect(validateOutreachSettings(settings)).toBe(true);});
 it.each([[-1,480],[1440,480],[1.5,480],[480,480]])('rejects invalid quiet range %s/%s',(quietStart,quietEnd)=>{expect(validateOutreachSettings({...settings,quietStart,quietEnd})).toBe(false);});
 it('rejects unrecognized zones and unbounded frequency',()=>{expect(validateOutreachSettings({...settings,timezone:'No/Such_Zone'})).toBe(false);expect(validateOutreachSettings({...settings,dailyLimit:3 as 1})).toBe(false);});
 it.each([[1319,false],[1320,true],[0,true],[479,true],[480,false]])('handles overnight quiet boundary %s',(minute,quiet)=>{expect(isQuietMinute(minute,settings)).toBe(quiet);});
 it('handles a daytime quiet interval',()=>{const s={...settings,quietStart:600,quietEnd:660};expect(isQuietMinute(630,s)).toBe(true);expect(isQuietMinute(660,s)).toBe(false);});
 it('uses explicit local day rather than host timezone including DST',()=>{expect(localOutreachClock(new Date('2026-10-24T23:30:00Z'),'Asia/Tokyo')).toEqual({day:'2026-10-25',minute:510});expect(localOutreachClock(new Date('2026-11-01T06:30:00Z'),'America/New_York').minute).toBe(90);});
 it('settles a short burst but bounds starvation at six seconds',()=>{const now=new Date(10000);expect(batchIsReady(new Date(9000),new Date(9500),now)).toBe(false);expect(batchIsReady(new Date(8000),new Date(8500),now)).toBe(true);expect(batchIsReady(new Date(4000),new Date(9999),now)).toBe(true);});
 it.each(['取消回复','先别回了','不用回复了'])('recognizes exact cancellation %s',text=>expect(isReplyCancellation(text)).toBe(true));
 it.each(['请解释“取消回复”的意思','不要取消回复','他说不用回复了'])('does not turn quoted or compound text into a command %s',text=>expect(isReplyCancellation(text)).toBe(false));
 it('recognizes exact outreach stop without enabling from chat',()=>{expect(isOutreachStop('关闭主动联系')).toBe(true);expect(isOutreachStop('不要关闭主动联系')).toBe(false);});
});
describe('007C durable generation and send boundary',()=>{
 const row:WeixinRow={message_key:'a'.repeat(64),user_id:'owner',text:'first',turn_text:'first\nsecond',context_token:'secret',reply:null,stage:'pending',attempts:0,retry_at:new Date(0)};
 it('generates from sealed text and sends once',async()=>{const converse=vi.fn(async()=> 'reply'),send=vi.fn(async()=>({ret:0})),update=vi.fn(),beginSend=vi.fn(async()=>true);await processWeixinMessage(row,{update,beginSend},{send},converse);expect(converse).toHaveBeenCalledWith('owner','first\nsecond','weixin-'+row.message_key);expect(send).toHaveBeenCalledTimes(1);});
 it('cancellation during generation prevents late output even after generation succeeds',async()=>{const send=vi.fn(),update=vi.fn();await processWeixinMessage(row,{update,beginSend:async()=>false},{send},async()=> 'generated but cancelled');expect(send).not.toHaveBeenCalled();expect(update.mock.calls.some(c=>c[1]==='accepted')).toBe(false);});
 it('ready proactive messages bypass the model and obey the same final boundary',async()=>{const converse=vi.fn(),send=vi.fn(async()=>({ret:0}));await processWeixinMessage({...row,origin:'proactive',reply:'早呀',stage:'ready'},{update:vi.fn(),beginSend:async()=>true},{send},converse);expect(converse).not.toHaveBeenCalled();expect(send).toHaveBeenCalledWith(row.message_key,'secret','早呀');});
});
