import {localOutreachClock,validTimezone,type OutreachSettings} from './weixin-policy.js';
import {normalizeCareTopic} from './proactive-care.js';
export type OutreachCommand={type:'status'|'list'|'care-list'|'help'|'invalid'|'enable'}|{type:'patch';patch:Partial<OutreachSettings>}|{type:'add';when:string;message:string}|{type:'care-add';when:string;topic:string}|{type:'cancel-reminder'|'cancel-care';reference:string}|{type:'confirm'|'cancel';code:string};
export function parseOutreachCommand(input:string):OutreachCommand|null{
 const t=input.trim();if(t==='主动联系状态')return {type:'status'};if(t==='提醒列表')return {type:'list'};if(t==='联系帮助')return {type:'help'};if(t==='开启主动联系')return {type:'enable'};
 if(t==='关心列表')return {type:'care-list'};if(t==='关心帮助')return {type:'help'};
 let care=/^(?:取消|结束)关心\s+([A-F0-9]{8})$/iu.exec(t);if(care)return {type:'cancel-care',reference:care[1].toUpperCase()};
 care=/^添加关心[：:]\s*(今天|明天|后天|\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\|\s*([^\r\n]{1,80})$/u.exec(t);
 if(care){const topic=normalizeCareTopic(care[3]);return topic&&clockMinute(care[2])!==null?{type:'care-add',when:care[1]+' '+care[2],topic}:{type:'invalid'};}
 if(/^(?:添加关心[：:]|(?:取消|结束)关心\s)/u.test(t))return {type:'invalid'};
 let m=/^(确认|取消)联系\s+([A-F0-9]{8})$/iu.exec(t);if(m)return {type:m[1]==='确认'?'confirm':'cancel',code:m[2].toUpperCase()};
 m=/^取消提醒\s+([A-F0-9]{8})$/iu.exec(t);if(m)return {type:'cancel-reminder',reference:m[1].toUpperCase()};
 m=/^设置免打扰[：:]\s*(\d{2}:\d{2})-(\d{2}:\d{2})$/u.exec(t);if(m){const a=clockMinute(m[1]),b=clockMinute(m[2]);return a!==null&&b!==null&&a!==b?{type:'patch',patch:{quietStart:a,quietEnd:b}}:{type:'invalid'};}
 m=/^设置联系时区[：:]\s*([^\s]{1,80})$/u.exec(t);if(m)return validTimezone(m[1])?{type:'patch',patch:{timezone:m[1]}}:{type:'invalid'};
 m=/^设置联系上限[：:]\s*([12])$/u.exec(t);if(m)return {type:'patch',patch:{dailyLimit:Number(m[1])as 1|2}};
 m=/^设置问候[：:]\s*(关闭|\d{2}:\d{2})$/u.exec(t);if(m){if(m[1]==='关闭')return {type:'patch',patch:{greeting:false}};const n=clockMinute(m[1]);return n!==null?{type:'patch',patch:{greeting:true,greetingMinute:n}}:{type:'invalid'};}
 m=/^添加提醒[：:]\s*(今天|明天|后天|\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s*\|\s*([^\r\n]{1,120})$/u.exec(t);if(m&&clockMinute(m[2])!==null&&m[3].trim())return {type:'add',when:m[1]+' '+m[2],message:m[3].trim()};
 return /^(?:设置(?:免打扰|联系时区|联系上限|问候)[：:]|添加提醒[：:]|取消提醒\s|(?:确认|取消)联系\s)/u.test(t)?{type:'invalid'}:null;
}
export const isOutreachCommandText=(text:string)=>parseOutreachCommand(text)!==null;
export const reminderReference=(id:string)=>id.replaceAll('-','').slice(-8).toUpperCase();
export function clockMinute(value:string):number|null{const m=/^(\d{2}):(\d{2})$/u.exec(value);return m&&Number(m[1])<24&&Number(m[2])<60?Number(m[1])*60+Number(m[2]):null;}
export const formatMinute=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
/** Enumerate possible UTC offsets, then round-trip each wall time; reject DST gaps and folds. */
export function outreachDue(when:string,zone:string,now:Date):Date|null{
 if(!validTimezone(zone)||!Number.isFinite(now.getTime()))return null;
 const m=/^(今天|明天|后天|\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/u.exec(when);if(!m||clockMinute(m[2])===null)return null;
 const local=localOutreachClock(now,zone).day,delta=({'今天':0,'明天':1,'后天':2}as Record<string,number>)[m[1]];
 const day=delta===undefined?m[1]:new Date(Date.parse(local+'T12:00Z')+delta*86400000).toISOString().slice(0,10),wall=Date.parse(day+'T'+m[2]+':00Z');
 if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,10)!==day)return null;
 const offsets=new Set<number>();for(let d=-2;d<=2;d++){const anchor=new Date(wall+d*86400000),c=localOutreachClock(anchor,zone);offsets.add(Date.parse(c.day+'T'+formatMinute(c.minute)+':00Z')-anchor.getTime());}
 const matches=[...offsets].map(o=>new Date(wall-o)).filter(v=>{const c=localOutreachClock(v,zone);return c.day===day&&c.minute===clockMinute(m[2])&&v.getTime()>now.getTime()&&v.getTime()<=now.getTime()+30*86400000;});
 return matches.length===1?matches[0]:null;
}
