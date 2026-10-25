import {randomUUID} from 'node:crypto';
import {DomainValidationError,type UserId} from '@yaoyao/domain';
import {EntityNotFoundError,IdempotencyKeyReusedError,StaleWriteError} from '../ports/persistence/errors.js';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
import {lifeExpiry,lifeIsActive,parseLifeChange,selectLifeTarget,validDay,validPreferences,type CompanionPreferences,type LifeChange,type LifeEvent} from '../experience.js';
export function experienceStore(tx:PersistenceTransaction){if(!tx.experience)throw Error('Companion experience unavailable');return tx.experience;}
export async function updatePreferences(tx:PersistenceTransaction,userId:UserId,settings:CompanionPreferences,expectedVersion:number){
 if(!validPreferences(settings)||!Number.isInteger(expectedVersion)||expectedVersion<0)throw new DomainValidationError('Invalid conversation preferences');return experienceStore(tx).savePreferences(userId,settings,expectedVersion);
}
/** All life mutations share the same entity lock as continuity and memory management. */
export async function applyLifeChange(tx:PersistenceTransaction,input:{userId:UserId;change:LifeChange;receivedAt:Date;timezone:string;sourceSequence:number;targetId?:string;expectedVersion?:number;manual?:boolean}):Promise<{event?:LifeEvent;ambiguous:boolean}>{
 const store=experienceStore(tx),aggregate=await tx.aggregates.loadOwned(input.userId);await tx.continuityProcessing.lockEntity(input.userId,aggregate.yaoyaoId);
 const events=await store.lifeEvents(input.userId,100),change=input.change;
 if(!change.subject.trim()||change.subject.length>50||!['planned','ongoing','completed','cancelled'].includes(change.state)||change.scheduledDay!==null&&!validDay(change.scheduledDay)||change.state==='planned'&&!change.scheduledDay)throw new DomainValidationError('Invalid life event');
 if(change.scheduledDay&&change.state==='planned'){const delta=(Date.parse(change.scheduledDay+'T12:00Z')-input.receivedAt.getTime())/86400000;if(delta>31||delta< -2)throw new DomainValidationError('Life date outside recent window');}
 let target:LifeEvent|undefined;
 if(input.targetId){target=events.find(e=>e.id===input.targetId);if(!target||target.version!==input.expectedVersion)throw new StaleWriteError('Life event',input.expectedVersion??0,target?.version??0);}
 else {
  if(!input.manual&&events.some(e=>e.subject===change.subject&&e.sourceSequence>=input.sourceSequence))return {ambiguous:false};
  const selected=selectLifeTarget(events.filter(e=>lifeIsActive(e,input.receivedAt,input.timezone)),change);if(selected.ambiguous)return {ambiguous:true};target=selected.target;
 }
 if(!target&&events.filter(e=>lifeIsActive(e,input.receivedAt,input.timezone)).length>=100)return {ambiguous:false};
 const effective={...change,scheduledDay:change.scheduledDay??target?.scheduledDay??null};
 const event:LifeEvent={id:target?.id??randomUUID(),subject:change.subject,state:change.state,scheduledDay:effective.scheduledDay,declaredAt:input.receivedAt,expiresAt:lifeExpiry(effective,input.receivedAt,input.timezone),sourceSequence:input.sourceSequence,version:(target?.version??0)+1};
 await store.saveLife(input.userId,event,target?.version??null);return {event,ambiguous:false};
}
export async function recordLifeStatement(tx:PersistenceTransaction,userId:UserId,source:{text:string;occurredAt:Date;sequence:number;timezone?:string}):Promise<void>{
 if(!tx.experience||source.occurredAt<await tx.experience.activationTime())return;
 const {settings}=await tx.experience.preferences(userId);const timezone=source.timezone??settings.timezone;const change=parseLifeChange(source.text,source.occurredAt,timezone);if(!change)return;
 await applyLifeChange(tx,{userId,change,receivedAt:source.occurredAt,timezone,sourceSequence:source.sequence});
}
export async function writeLifeFromSettings(tx:PersistenceTransaction,input:{userId:UserId;requestId:string;change:LifeChange;targetId?:string;expectedVersion?:number}){
 const store=experienceStore(tx),aggregate=await tx.aggregates.loadOwned(input.userId);await tx.continuityProcessing.lockEntity(input.userId,aggregate.yaoyaoId);
 const key='life-ui:'+input.requestId,body=JSON.stringify(input.targetId?{targetId:input.targetId,expectedVersion:input.expectedVersion??null,state:input.change.state}:{change:input.change});const prior=await store.commandReply(input.userId,key);
 if(prior){if(prior.text!==body)throw new IdempotencyKeyReusedError('life-event');const cached=JSON.parse(prior.reply) as {event:LifeEvent};return {event:{...cached.event,declaredAt:new Date(cached.event.declaredAt),expiresAt:new Date(cached.event.expiresAt)}};}
 let change=input.change;
 if(input.targetId){const current=(await store.lifeEvents(input.userId,100)).find(e=>e.id===input.targetId);if(!current)throw new EntityNotFoundError('Life event');change={subject:current.subject,state:input.change.state,scheduledDay:current.scheduledDay};}
 const {settings}=await store.preferences(input.userId),latest=tx.events.readWindow?(await tx.events.readWindow(input.userId,aggregate.yaoyaoId,{limit:1})).events:await tx.events.readOwnedAfter(input.userId,aggregate.yaoyaoId,0);
 const sequence=Math.max(1,...latest.map(e=>e.aggregateSeq));const result=await applyLifeChange(tx,{...input,change,receivedAt:new Date(),timezone:settings.timezone,sourceSequence:sequence,manual:true});
 if(!result.event)throw new DomainValidationError(result.ambiguous?'Select the exact life event':'Recent-life capacity reached');await store.saveCommandReply(input.userId,key,body,JSON.stringify({event:result.event}));return {event:result.event};
}
