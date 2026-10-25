/** Personal-channel pacing and opt-in outreach policy. No I/O or model inference. */
export interface OutreachSettings {
 enabled:boolean; timezone:string; quietStart:number; quietEnd:number;
 dailyLimit:1|2; greeting:boolean; greetingMinute:number;
}
export const DEFAULT_OUTREACH:Readonly<OutreachSettings>=Object.freeze({enabled:false,timezone:'Asia/Tokyo',quietStart:22*60,quietEnd:8*60,dailyLimit:1,greeting:false,greetingMinute:9*60});
export function validTimezone(zone:string):boolean {
 try{return zone.length<=80&&!!new Intl.DateTimeFormat('en',{timeZone:zone}).format(new Date(0));}catch{return false;}
}
export function validateOutreachSettings(value:OutreachSettings):boolean {
 return typeof value.enabled==='boolean'&&typeof value.greeting==='boolean'&&validTimezone(value.timezone)&&
 [value.quietStart,value.quietEnd,value.greetingMinute].every(v=>Number.isInteger(v)&&v>=0&&v<1440)&&
 value.quietStart!==value.quietEnd&&[1,2].includes(value.dailyLimit);
}
export function localOutreachClock(now:Date,timezone:string):{day:string;minute:number} {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const part=(key:string)=>parts.find(p=>p.type===key)!.value;
 return {day:`${part('year')}-${part('month')}-${part('day')}`,minute:Number(part('hour'))*60+Number(part('minute'))};
}
export function isQuietMinute(minute:number,settings:OutreachSettings):boolean {
 return settings.quietStart<settings.quietEnd?minute>=settings.quietStart&&minute<settings.quietEnd:minute>=settings.quietStart||minute<settings.quietEnd;
}
export const WEIXIN_BATCH_SETTLE_MS=1500;
export const WEIXIN_BATCH_MAX_WAIT_MS=6000;
export function isReplyCancellation(text:string):boolean {
 return /^(?:先别回(?:了)?|不用回(?:复)?(?:了)?|取消回复)[。！!\s]*$/u.test(text.trim());
}
export function isOutreachStop(text:string):boolean {
 return /^(?:别主动找我(?:了)?|不要主动联系我(?:了)?|关闭主动联系|停止主动联系|暂停主动联系)[。！!\s]*$/u.test(text.trim());
}
/** A bounded window allows a burst to settle without postponing an endless stream. */
export function batchIsReady(first:Date,last:Date,now:Date):boolean {
 return now.getTime()-last.getTime()>=WEIXIN_BATCH_SETTLE_MS||now.getTime()-first.getTime()>=WEIXIN_BATCH_MAX_WAIT_MS;
}
