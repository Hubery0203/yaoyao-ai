import {randomBytes} from 'node:crypto';
import type {UserId} from '@yaoyao/domain';
import {StaleWriteError,IdempotencyKeyReusedError} from '../ports/persistence/errors.js';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
import {DEFAULT_PREFERENCES,validPreferences,parseLifeChange,lifeIsActive,selectLifeTarget,type CompanionPreferences,type LifeEvent,type CompanionExperienceStore} from '../experience.js';
import {parseCompanionCommand,lifeReference,type CompanionActionStore,type CompanionAction,type LifeActionPayload} from '../companion-commands.js';
import {experienceStore,updatePreferences,applyLifeChange} from './experience.js';
import {persistUserMessage,persistAssistantMessage,findCompletedTurn} from './conversation.js';
const HELP='设置列表 / 近况列表\n设置称呼：小雨\n设置回复：简短 / 自然 / 详细\n设置亲昵：自然 / 克制\n设置追问：少问 / 自然\n设置建议：按需 / 自然\n设置时区：Asia/Tokyo\n恢复默认设置\n记录近况：我明天要面试\n更新近况 编号：完成 / 取消 / 开始 / 改到明天\n修改先预览，10分钟内确认设置或确认近况，也可取消。';
const labels={brief:'简短',balanced:'自然',detailed:'详细',warm:'自然',reserved:'克制',minimal:'少问',natural:'自然',on_request:'按需',planned:'计划',ongoing:'进行中',completed:'已完成',cancelled:'已取消'};
function preferenceText(p:CompanionPreferences){return '称呼：'+(p.nickname||'不设置')+'\n回复：'+labels[p.length]+'；亲昵：'+labels[p.affection]+'\n追问：'+labels[p.questions]+'；建议：'+labels[p.advice]+'\n时区：'+p.timezone;}
function patchText(p:Partial<CompanionPreferences>){const names:Record<string,string>={nickname:'称呼',length:'回复',affection:'亲昵',questions:'追问',advice:'建议',timezone:'时区'};return Object.entries(p).map(([k,v])=>names[k]+'：'+(k==='nickname'?(v||'不设置'):k==='timezone'?v:labels[v as keyof typeof labels])).join('\n');}
function actions(store:CompanionExperienceStore):CompanionActionStore{if(!store.pendingCompanionAction||!store.saveCompanionAction||!store.resolveCompanionAction)throw Error('Companion command schema unavailable');return store as CompanionExperienceStore&CompanionActionStore;}
const subjectVersions=(events:LifeEvent[],subject:string)=>JSON.stringify(events.filter(e=>e.subject===subject).map(e=>[e.id,e.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
async function preview(store:CompanionExperienceStore,uid:UserId,data:Pick<CompanionAction,'kind'|'payload'>){
 const api=actions(store);let code='';for(let i=0;i<3;i++){const c=randomBytes(3).toString('hex').toUpperCase();if(!await api.pendingCompanionAction(uid,c)){code=c;break;}}if(!code)throw Error('Companion confirmation collision');
 await api.saveCompanionAction(uid,{...data,code,expiresAt:new Date(Date.now()+600000),status:'pending'}as CompanionAction);
 return '\n10分钟内发送“确认'+(data.kind==='preferences'?'设置':'近况')+' '+code+'”生效；不改可发送“取消'+(data.kind==='preferences'?'设置':'近况')+' '+code+'”。';
}
/** Commands and their final status/history commit atomically; no text model or implicit personal fact writes. */
export async function handleWeixinCompanionCommand(tx:PersistenceTransaction,input:{userId:UserId;text:string;requestId:string}):Promise<string|null>{
 const cmd=parseCompanionCommand(input.text);if(!cmd)return null;
 const store=experienceStore(tx),aggregate=await tx.aggregates.loadOwned(input.userId);await tx.continuity.lockTurn(input.userId,aggregate.yaoyaoId,input.requestId);await tx.continuityProcessing.lockEntity(input.userId,aggregate.yaoyaoId);
 const prior=await store.commandReply(input.userId,input.requestId);if(prior){if(prior.text!==input.text)throw new IdempotencyKeyReusedError('companion-command');return prior.reply;}
 const completed=await findCompletedTurn(tx,{...input,yaoyaoId:aggregate.yaoyaoId});if(completed!==null){await store.saveCommandReply(input.userId,input.requestId,input.text,completed);return completed;}
 const history={...input,yaoyaoId:aggregate.yaoyaoId,sessionId:null,traceId:input.requestId};await persistUserMessage(tx,history);
 const userEvents=tx.events.readWindow?(await tx.events.readWindow(input.userId,aggregate.yaoyaoId,{requestId:input.requestId,types:['USER_MESSAGE'],limit:1})).events:await tx.events.readOwnedAfter(input.userId,aggregate.yaoyaoId,0);
 const source=userEvents.find(e=>e.event.correlationId===input.requestId&&e.event.type==='USER_MESSAGE');if(!source)throw Error('Command source missing');
 const uid=input.userId,now=source.event.occurredAt,pref=await store.preferences(uid);
 let reply:string;
 if(cmd.type==='preferences')reply=preferenceText(pref.settings);
 else if(cmd.type==='help'||cmd.type==='invalid')reply=HELP;
 else if(cmd.type==='life'){
  const events=(await store.lifeEvents(uid,100)).slice(0,10);reply=events.length?'近期记录（最近10条）：\n'+events.map(e=>lifeReference(e.id)+' '+e.subject+' '+labels[e.state]+(e.scheduledDay?' '+e.scheduledDay:'')+(lifeIsActive(e,now,pref.settings.timezone)?'':' [已过期，仅保留记录]')).join('\n')+'\n用“更新近况 编号：完成/取消/开始/改到明天”修改。':'目前没有近期记录。';
 }else if(cmd.type==='patch'||cmd.type==='reset'){
  const settings=cmd.type==='reset'?{...DEFAULT_PREFERENCES}:{...pref.settings,...cmd.patch};
  if(!validPreferences(settings))reply='设置格式不对，称呼最多20字，时区请使用Asia/Tokyo这样的名称。';
  else if((Object.keys(DEFAULT_PREFERENCES)as (keyof CompanionPreferences)[]).every(k=>settings[k]===pref.settings[k]))reply='已经是这个设置啦。';
  else reply='将改为：\n'+(cmd.type==='patch'?patchText(cmd.patch):preferenceText(settings))+await preview(store,uid,{kind:'preferences',payload:{settings,expectedVersion:pref.version}});
 }else if(cmd.type==='confirm'||cmd.type==='cancel'){
  const api=actions(store),action=await api.pendingCompanionAction(uid,cmd.code);
  if(!action||action.kind!==cmd.kind||action.status!=='pending'||action.expiresAt<=new Date())reply='这个确认码已失效，请重新发送操作。';
  else if(cmd.type==='cancel'){await api.resolveCompanionAction(uid,cmd.code,'cancelled');reply='已取消，这次不修改。';}
  else if(action.kind==='preferences'){
   if(!validPreferences(action.payload.settings)||pref.version!==action.payload.expectedVersion){await api.resolveCompanionAction(uid,cmd.code,'cancelled');reply='设置已变化，请重新查看后操作。';}
   else {try{await updatePreferences(tx,uid,action.payload.settings,action.payload.expectedVersion);await api.resolveCompanionAction(uid,cmd.code,'done');reply='好，以后按这个设置来。';}catch(e){if(!(e instanceof StaleWriteError))throw e;await api.resolveCompanionAction(uid,cmd.code,'cancelled');reply='设置已变化，请重新查看后操作。';}}
  }else {
   const p=action.payload,events=await store.lifeEvents(uid,100),current=p.targetId?events.find(e=>e.id===p.targetId):undefined;
   const stale=p.timezone!==pref.settings.timezone||(p.targetId?(!current||current.version!==p.expectedVersion):subjectVersions(events,p.change.subject)!==p.subjectVersions);
   if(stale){await api.resolveCompanionAction(uid,cmd.code,'cancelled');reply='近况或时区已变化，请重新查看后操作。';}
   else {const result=await applyLifeChange(tx,{userId:uid,change:p.change,receivedAt:now,timezone:p.timezone,sourceSequence:source.aggregateSeq,targetId:p.targetId??undefined,expectedVersion:p.expectedVersion??undefined,manual:true});if(!result.event)reply='这次没能明确对应到一条记录，请重新查看近况列表。';else {await api.resolveCompanionAction(uid,cmd.code,'done');reply='已更新：'+result.event.subject+' '+labels[result.event.state]+(result.event.scheduledDay?'（计划日期 '+result.event.scheduledDay+'）':'')+'。';}}
  }
 }else if(cmd.type==='life-create'||cmd.type==='life-update'){
  const events=await store.lifeEvents(uid,100);let change=null,target:LifeEvent|undefined,ambiguous=false;
  if(cmd.type==='life-create'){
   change=parseLifeChange(cmd.statement,now,pref.settings.timezone);
   if(change){const selection=selectLifeTarget(events.filter(e=>lifeIsActive(e,now,pref.settings.timezone)),change);target=selection.target;ambiguous=selection.ambiguous;}
  }else {
   const matches=events.filter(e=>lifeReference(e.id)===cmd.reference);target=matches.length===1?matches[0]:undefined;ambiguous=matches.length!==1;
   if(target){const words:Record<string,string>={'完成':'完成了','取消':'取消了','开始':'开始了'};change=parseLifeChange(target.subject+(words[cmd.statement]??cmd.statement.replace(/^(?:延期到|推迟到)/u,'改到')),now,pref.settings.timezone);}
  }
  if(ambiguous)reply='记录编号不明确，或同一事情有多条记录，请先发送“近况列表”再按编号修改。';
  else if(!change)reply='请一次明确说一件事，例如“记录近况：我明天要面试”，或按编号更新完成、取消、开始、改到明天。';
  else if(change.state==='planned'&&change.scheduledDay&&(Date.parse(change.scheduledDay+'T12:00Z')-now.getTime())/86400000>31)reply='计划日期太远，先记未来31天内的近况。';
  else if(change.state==='planned'&&change.scheduledDay&&(Date.parse(change.scheduledDay+'T12:00Z')-now.getTime())/86400000< -2)reply='计划日期已超出近期范围，请核对日期。';
  else {
   const payload:LifeActionPayload={change:{...change,scheduledDay:change.scheduledDay??target?.scheduledDay??null},targetId:target?.id??null,expectedVersion:target?.version??null,timezone:pref.settings.timezone,subjectVersions:subjectVersions(events,change.subject)};
   reply='将记录：'+change.subject+' '+labels[change.state]+(payload.change.scheduledDay?'，计划日期 '+payload.change.scheduledDay:'')+await preview(store,uid,{kind:'life',payload});
  }
 }else reply=HELP;
 await persistAssistantMessage(tx,{...history,text:reply});await store.saveCommandReply(uid,input.requestId,input.text,reply);return reply;
}
