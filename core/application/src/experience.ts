import type {UserId} from '@yaoyao/domain';
import {localOutreachClock,validTimezone} from './weixin-policy.js';
export interface CompanionPreferences {nickname:string;length:'brief'|'balanced'|'detailed';affection:'warm'|'reserved';questions:'minimal'|'natural';advice:'on_request'|'natural';timezone:string}
export const DEFAULT_PREFERENCES:Readonly<CompanionPreferences>=Object.freeze({nickname:'',length:'brief',affection:'warm',questions:'minimal',advice:'on_request',timezone:'Asia/Tokyo'});
export interface PreferenceRecord {settings:CompanionPreferences;version:number}
export function validPreferences(p:CompanionPreferences):boolean{return typeof p.nickname==='string'&&p.nickname.length<=20&&!/[\u0000-\u001f\u007f]/u.test(p.nickname)&&['brief','balanced','detailed'].includes(p.length)&&['warm','reserved'].includes(p.affection)&&['minimal','natural'].includes(p.questions)&&['on_request','natural'].includes(p.advice)&&validTimezone(p.timezone);}
export type LifeState='planned'|'ongoing'|'completed'|'cancelled';
export interface LifeEvent {id:string;subject:string;state:LifeState;scheduledDay:string|null;declaredAt:Date;expiresAt:Date;sourceSequence:number;version:number}
export interface LifeChange {subject:string;state:LifeState;scheduledDay:string|null;reschedule?:boolean}
export function validDay(day:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;}
export function shiftDay(day:string,days:number):string{return new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
const subjects='面试|考试|出差|旅行|搬家|体检|开会|项目';
/** Literal, single owner statement. No semantic extraction or inferred outcome. */
export function parseLifeChange(input:string,receivedAt:Date,timezone:string):LifeChange|null {
 const text=input.trim().replace(/[。！!]$/u,'');
 if(text.length>150||/[？?“”「」『』"\n]|如果|假如|要是|例如|帮我|请问|听说/u.test(text))return null;
 const today=localOutreachClock(receivedAt,timezone).day;
 const day=(value:string)=>value==='今天'?today:value==='明天'?shiftDay(today,1):value==='后天'?shiftDay(today,2):value;
 let m=new RegExp('^我(?:在)?(今天|明天|后天|\\d{4}-\\d{2}-\\d{2})(?:要|准备|计划)(?:去|参加)?('+subjects+')$','u').exec(text);
 if(m&&validDay(day(m[1])))return {subject:m[2],state:'planned',scheduledDay:day(m[1])};
 m=new RegExp('^(?:我的|我)?('+subjects+')(?:改到|改成)(今天|明天|后天|\\d{4}-\\d{2}-\\d{2})$','u').exec(text);
 if(m&&validDay(day(m[2])))return {subject:m[1],state:'planned',scheduledDay:day(m[2]),reschedule:true};
 m=new RegExp('^(?:我的|我)?('+subjects+')(结束了|完成了|取消了|开始了)$','u').exec(text);
 if(m)return {subject:m[1],state:m[2]==='取消了'?'cancelled':m[2]==='开始了'?'ongoing':'completed',scheduledDay:null};
 return null;
}
export function lifeExpiry(change:LifeChange,receivedAt:Date,timezone:string):Date{
 if(change.state==='planned'&&change.scheduledDay){const today=localOutreachClock(receivedAt,timezone).day;const days=Math.round((Date.parse(change.scheduledDay+'T12:00Z')-Date.parse(today+'T12:00Z'))/86400000);return new Date(receivedAt.getTime()+Math.max(1,days+2)*86400000);}
 return new Date(receivedAt.getTime()+7*86400000);
}
export function lifeIsActive(event:LifeEvent,now:Date,timezone:string):boolean{return event.expiresAt>now&&!(event.state==='planned'&&event.scheduledDay&&event.scheduledDay<shiftDay(localOutreachClock(now,timezone).day,-1));}
export function selectLifeTarget(events:readonly LifeEvent[],change:LifeChange):{target?:LifeEvent;ambiguous:boolean}{
 const matches=events.filter(e=>e.subject===change.subject&&(change.state==='planned'&&!change.reschedule?e.scheduledDay===change.scheduledDay:['planned','ongoing'].includes(e.state)));
 if(!matches.length&&change.state!=='planned'){const prior=events.filter(e=>e.subject===change.subject);return {target:prior.length===1?prior[0]:undefined,ambiguous:prior.length>1};}
 return {target:matches.length===1?matches[0]:undefined,ambiguous:matches.length>1};
}
export interface MemoryAction {code:string;kind:'remember'|'correct'|'disable';memoryId:string|null;expectedVersion:number|null;statement:string|null;expiresAt:Date;status:'pending'|'done'|'cancelled'}
export interface CompanionExperienceStore {
 preferences(userId:UserId):Promise<PreferenceRecord>;
 savePreferences(userId:UserId,settings:CompanionPreferences,expectedVersion:number):Promise<PreferenceRecord>;
 activationTime():Promise<Date>;
 lifeEvents(userId:UserId,limit:number):Promise<LifeEvent[]>;
 saveLife(userId:UserId,event:LifeEvent,expectedVersion:number|null):Promise<void>;
 mutedSlots(userId:UserId):Promise<Record<string,number>>;
 setMuted(userId:UserId,slot:string,sequence:number|null):Promise<void>;
 commandReply(userId:UserId,key:string):Promise<{text:string;reply:string}|null>;
 saveCommandReply(userId:UserId,key:string,text:string,reply:string):Promise<void>;
 pendingAction(userId:UserId,code:string):Promise<MemoryAction|null>;
 saveAction(userId:UserId,action:MemoryAction):Promise<void>;
 resolveAction(userId:UserId,code:string,status:'done'|'cancelled'):Promise<void>;
}
export interface CompanionExperienceContext {preferences:CompanionPreferences;lifeEvents:readonly LifeEvent[];activatedAt?:Date}
export function isMemoryCommandText(text:string):boolean{return /^(?:记忆列表|记忆帮助|记住[：:]|纠正记忆\s|停用记忆\s|确认\s*[A-F0-9]{6}$|取消\s*[A-F0-9]{6}$)/iu.test(text.trim());}
