import {randomBytes} from 'node:crypto';
import {DomainEvent,DomainValidationError,Memory,extractExplicitMemories,newEventId,type MemoryId,type UserId} from '@yaoyao/domain';
import {IdempotencyKeyReusedError} from '../ports/persistence/errors.js';
import type {PersistenceTransaction} from '../ports/persistence/transactions.js';
import {isMemoryCommandText,type MemoryAction} from '../experience.js';
import {experienceStore} from './experience.js';
import {correctOwnedMemory} from './memory-management.js';
import {persistUserMessage,persistAssistantMessage,findCompletedTurn} from './conversation.js';
const HELP='记忆操作：\n记忆列表\n记住：我喜欢桂花乌龙茶\n纠正记忆 编号：我不喜欢桂花乌龙茶了\n停用记忆 编号\n修改会先预览，10 分钟内发送“确认 六位码”才生效；可发送“取消 六位码”。停用只停止长期召回，聊天历史保留。重要记忆请到网页处理。';
// UUIDv7 prefixes share a timestamp; use random suffix bytes for owner-visible references.
const reference=(id:string)=>id.replaceAll('-','').slice(-8).toUpperCase();
function oneFact(text:string){const c=extractExplicitMemories(text);return c.length===1&&c[0].kind==='fact'&&c[0].type==='SEMANTIC'&&c[0].content===text.trim().replace(/[。！.!]$/u,'')?c[0]:null;}
/** Exact command protocol, not model interpretation. The full reply and changes commit together. */
export async function handleWeixinMemoryCommand(tx:PersistenceTransaction,input:{userId:UserId;text:string;requestId:string}):Promise<string|null>{
 if(!isMemoryCommandText(input.text))return null;
 const store=experienceStore(tx),aggregate=await tx.aggregates.loadOwned(input.userId);await tx.continuity.lockTurn(input.userId,aggregate.yaoyaoId,input.requestId);await tx.continuityProcessing.lockEntity(input.userId,aggregate.yaoyaoId);
 const prior=await store.commandReply(input.userId,input.requestId);if(prior){if(prior.text!==input.text)throw new IdempotencyKeyReusedError('memory-command');return prior.reply;}
 const completed=await findCompletedTurn(tx,{...input,yaoyaoId:aggregate.yaoyaoId});if(completed!==null){await store.saveCommandReply(input.userId,input.requestId,input.text,completed);return completed;}
 const history={...input,yaoyaoId:aggregate.yaoyaoId,sessionId:null,traceId:input.requestId};await persistUserMessage(tx,history);
 const reply=await command(tx,input);
 await persistAssistantMessage(tx,{...history,text:reply});await store.saveCommandReply(input.userId,input.requestId,input.text,reply);return reply;
}
async function command(tx:PersistenceTransaction,input:{userId:UserId;text:string;requestId:string}):Promise<string>{
 const {userId}=input,store=experienceStore(tx),text=input.text.trim();
 if(text==='记忆帮助')return HELP;
 if(text==='记忆列表'){
  const memories=await tx.memories.listOwned(userId,{status:'CONSOLIDATED',limit:10});
  return memories.length?'当前记忆（最近 10 条）：\n'+memories.map(m=>reference(String(m.memoryId))+' '+(m.type==='CORE'?'[重要] ':'')+m.content.slice(0,150)).join('\n')+'\n可发送“纠正记忆 编号：新说法”或“停用记忆 编号”。':'目前没有已生效的长期记忆。';
 }
 const confirmation=/^(确认|取消)\s*([A-F0-9]{6})$/iu.exec(text);
 if(confirmation){
  const code=confirmation[2].toUpperCase(),a=await store.pendingAction(userId,code);
  if(!a||a.status!=='pending'||a.expiresAt<=new Date())return '这个确认码已失效，请重新发送操作。';
  if(confirmation[1]==='取消'){await store.resolveAction(userId,code,'cancelled');return '已取消，这次不修改记忆。';}
  const aggregate=await tx.aggregates.loadOwned(userId);
  if(a.memoryId){
   const memory=await tx.memories.findOwned(userId,a.memoryId as MemoryId);
   if(memory.status!=='CONSOLIDATED'||memory.version!==a.expectedVersion||memory.type==='CORE'){await store.resolveAction(userId,code,'cancelled');return '这条记忆已变化，请重新查看列表后操作。';}
   if(a.kind==='disable'){
    const slot=await tx.continuityProcessing.findSlotByMemory?.(userId,aggregate.yaoyaoId,memory.memoryId);if(!slot){await store.resolveAction(userId,code,'cancelled');return '这条记忆暂不支持微信停用，请到网页处理。';}
    const e=await tx.events.append({event:DomainEvent.create({type:'MEMORY_CORRECTED',actor:'USER',source:'CLIENT',userId,yaoyaoId:aggregate.yaoyaoId,correlationId:'memory-command:'+input.requestId,payload:{operation:'owner_disabled',memoryId:memory.memoryId,policy:'weixin-memory-v1'}})});
    await tx.memories.save(userId,memory.archive('owner_disabled'));await store.setMuted(userId,slot.slot,e.aggregateSeq);await store.resolveAction(userId,code,'done');return '已停用这条长期记忆，聊天历史仍保留。';
   }
   await correctOwnedMemory(tx,{userId,memoryId:memory.memoryId,expectedVersion:memory.version,text:a.statement!,requestId:input.requestId});await store.resolveAction(userId,code,'done');return '已按你的新说法纠正，旧版本保留。';
  }
  const candidate=oneFact(a.statement!);if(!candidate)throw new DomainValidationError('Invalid stored memory preview');
  const previous=await tx.continuityProcessing.findSlot(userId,aggregate.yaoyaoId,candidate.slot);
  if(previous){await store.resolveAction(userId,code,'cancelled');return '这个偏好或资料已有新记录，请重新发送操作。';}
  const sourceId=newEventId(),container=await tx.memoryContainers.findOwned(userId);
  const memory=Memory.candidate({containerId:container.containerId,userId,yaoyaoId:aggregate.yaoyaoId,type:'SEMANTIC',content:'用户陈述：'+candidate.content,confidence:1,sourceEvents:[sourceId]}).validate().consolidate();
  const source=await tx.events.append({event:DomainEvent.create({eventId:sourceId,type:'MEMORY_CORRECTED',actor:'USER',source:'CLIENT',userId,yaoyaoId:aggregate.yaoyaoId,correlationId:'memory-command:'+input.requestId,payload:{operation:'owner_recorded',memoryId:memory.memoryId,statement:a.statement,policy:'weixin-memory-v1'}})});
  await tx.memories.insert(memory);await tx.continuityProcessing.setSlot(userId,aggregate.yaoyaoId,candidate.slot,candidate.value,memory.memoryId,source.aggregateSeq);await store.setMuted(userId,candidate.slot,null);await store.resolveAction(userId,code,'done');return '已记下这条长期记忆。';
 }
 let kind:MemoryAction['kind'],statement:string|null=null,memoryId:string|null=null,expectedVersion:number|null=null;
 const remember=/^记住[：:]\s*([^\n]{1,500})$/u.exec(text),correct=/^纠正记忆\s+([A-F0-9]{8})[：:]\s*([^\n]{1,500})$/iu.exec(text),disable=/^停用记忆\s+([A-F0-9]{8})$/iu.exec(text);
 if(remember){
  const candidate=oneFact(remember[1]);if(!candidate)return '请一次明确说一个偏好、名字或居住地，例如“记住：我喜欢桂花乌龙茶”。临时心情和计划不记为长期事实。';
  kind='remember';statement=candidate.content;
  const aggregate=await tx.aggregates.loadOwned(userId),slot=await tx.continuityProcessing.findSlot(userId,aggregate.yaoyaoId,candidate.slot);
  if(slot){const old=await tx.memories.findOwned(userId,slot.memoryId);if(old.type==='CORE')return '重要记忆请到网页确认，微信不会直接修改。';if(slot.value===candidate.value)return '这条已经在当前记忆里。';memoryId=String(old.memoryId);expectedVersion=old.version;}
 }else if(correct||disable){
  const token=(correct??disable)![1].toUpperCase(),matches=(await tx.memories.listOwned(userId,{status:'CONSOLIDATED',limit:100})).filter(m=>reference(String(m.memoryId))===token);
  if(matches.length!==1)return '编号不存在、已过期或不唯一，请先发送“记忆列表”。';
  const memory=matches[0];if(memory.type==='CORE')return '重要记忆请到网页确认，微信不会直接修改。';
  const aggregate=await tx.aggregates.loadOwned(userId),slot=await tx.continuityProcessing.findSlotByMemory?.(userId,aggregate.yaoyaoId,memory.memoryId);
  if(!slot)return '这条记忆暂不支持微信管理，请到网页处理。';
  kind=correct?'correct':'disable';memoryId=String(memory.memoryId);expectedVersion=memory.version;
  if(correct){statement=correct[2].trim();const c=oneFact(statement);if(!c||c.slot!==slot.slot||c.value===slot.value||c.type!==memory.type)return '请明确纠正同一个偏好、名字或居住地；其他内容请用“记住：……”新增。';}
 }else return HELP;
 let code='';for(let i=0;i<3;i++){const candidate=randomBytes(3).toString('hex').toUpperCase();if(!await store.pendingAction(userId,candidate)){code=candidate;break;}}if(!code)throw Error('Confirmation code collision');
 await store.saveAction(userId,{code,kind,memoryId,expectedVersion,statement,expiresAt:new Date(Date.now()+600000),status:'pending'});
 return (kind==='disable'?'将停用编号 '+reference(memoryId!)+' 的长期记忆，历史保留。':'将'+(memoryId?'纠正为：':'记住：')+statement)+'\n10 分钟内发送“确认 '+code+'”生效；不改请发送“取消 '+code+'”。';
}
