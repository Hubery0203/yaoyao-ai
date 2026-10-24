/** One personal Weixin channel; the existing Core remains the conversation authority. */
import {Inject,Injectable,Optional,type OnModuleInit} from '@nestjs/common';
import {constants} from 'node:fs';
import {open,stat} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {type WeixinChannelPort} from '@yaoyao/application';
import {type UserId} from '@yaoyao/domain';
import {CONVERSATION_ORCHESTRATOR,ConversationOrchestrator,summarizeTurnQuality,summarizeTurnPerformance} from '@yaoyao/runtime';
import {loadConfig,WeixinClient,WeixinStore,WeixinError,extractText,type WeixinCredentials,type WeixinRow} from '@yaoyao/infrastructure';
import {LiteRuntimeService} from './lite-runtime.service.js';
const sleep=(ms:number)=>new Promise<void>(resolve=>{setTimeout(resolve,ms);});
export async function readWeixinCredentials(path:string):Promise<WeixinCredentials>{
 if(!isAbsolute(path))throw Error('ABSOLUTE_CREDENTIAL_PATH_REQUIRED');
 const parent=await stat(dirname(path));if(parent.mode&0o077)throw Error('PRIVATE_CREDENTIAL_DIRECTORY_REQUIRED');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const s=await file.stat();if(!s.isFile()||s.mode&0o077||s.size>32768)throw Error('PRIVATE_CREDENTIAL_FILE_REQUIRED');
  const c=JSON.parse(await file.readFile('utf8'));
  if(['base','token','botId','ownerId'].some(k=>typeof c[k]!=='string'||!c[k]||c[k].length>16384))throw Error('INVALID_CREDENTIALS');
  return {base:c.base,token:c.token,botId:c.botId,ownerId:c.ownerId};
 }finally{await file.close();}
}
export async function processWeixinMessage(row:WeixinRow,store:Pick<WeixinStore,'update'>,client:Pick<WeixinClient,'send'>,converse:(userId:string,text:string,key:string)=>Promise<string>):Promise<void>{
 if(['uncertain','failed'].includes(row.stage)||new Date(row.retry_at).getTime()>Date.now())return;
 let reply=row.reply;
 if(!reply){
  await store.update(row.message_key,'generating',{attempt:true});
  try{reply=await converse(row.user_id,row.text,'weixin-'+row.message_key);await store.update(row.message_key,'ready',{reply});}
  catch{await store.update(row.message_key,row.attempts>=2?'failed':'pending',{error:'GENERATION_FAILED',delay:Math.min(60000,5000*2**row.attempts)});return;}
 }
 await store.update(row.message_key,'sending',{attempt:true});
 try{
  const text=reply.length>4000?reply.slice(0,3975)+'…（完整回复见网页）':reply;
  const ack=await client.send(row.message_key,row.context_token,text);
  await store.update(row.message_key,'accepted',{ack:ack.ret===0||ack.errcode===0?'api_accepted':'http_accepted'});
 }catch(error){
  const code=error instanceof WeixinError?error.code:'SEND_RESULT_UNKNOWN';
  // Explicit rejections did not deliver. Transport failures may have delivered.
  if(['AUTH_EXPIRED','RATE_LIMITED','API_REJECTED'].includes(code)){
   await store.update(row.message_key,row.attempts>=4?'failed':'ready',{error:code,delay:Math.min(60000,5000*2**Math.min(row.attempts,4))});
   if(code==='AUTH_EXPIRED')throw error;
  }else await store.update(row.message_key,'uncertain',{error:'SEND_RESULT_UNKNOWN'});
 }
}
@Injectable()
export class WeixinBridgeService implements OnModuleInit,WeixinChannelPort {
 private readonly config=loadConfig();private store?:WeixinStore;private client?:WeixinClient;private running?:Promise<void>;private stopped=false;
 constructor(@Inject('YAOYAO_PG_POOL') private readonly pool:Pool,@Inject(CONVERSATION_ORCHESTRATOR) private readonly core:ConversationOrchestrator,@Inject(LiteRuntimeService) private readonly gate:LiteRuntimeService,
  @Optional() @Inject('CONVERSATION_QUALITY') private readonly quality?:{record(entry:ReturnType<typeof summarizeTurnQuality>):void},
  @Optional() @Inject('CONVERSATION_PERFORMANCE') private readonly performance?:{record(entry:ReturnType<typeof summarizeTurnPerformance>,source:'web'|'weixin'):void}){}
 async onModuleInit():Promise<void>{
  if(this.config.WEIXIN_ENABLED!=='1')return;
  if(!this.config.WEIXIN_CREDENTIALS_FILE||!this.config.DATABASE_URL)throw Error('WEIXIN_CONFIGURATION_REQUIRED');
  const credentials=await readWeixinCredentials(this.config.WEIXIN_CREDENTIALS_FILE);
  this.client=new WeixinClient(credentials);this.store=new WeixinStore(this.pool,credentials,this.config.DATABASE_URL);
  try{await this.store.open();}catch{await this.store.close();throw Error('WEIXIN_START_FAILED');}
  this.running=this.loop().catch(()=>{console.warn('Weixin channel stopped; operator review required.');});
 }
 async stop():Promise<void>{this.stopped=true;this.client?.close();await this.running;if(this.client){const shutdown=new WeixinClient(this.client.credentials);try{await shutdown.post('msg/notifystop',{},3000);}catch{/* Best effort lifecycle notification. */}finally{shutdown.close();}}await this.store?.close();}
 private async loop():Promise<void>{
  const store=this.store!,client=this.client!;
  try{await client.post('msg/notifystart',{},10000);}catch(e){if(e instanceof WeixinError&&e.code==='AUTH_EXPIRED'){await store.error('AUTH_EXPIRED',true);return;}}
  while(!this.stopped&&store.healthy){
   try{
    const c=await store.channel();
    if(c.user_id)this.gate.registerOwner(c.user_id);
    if(c.paused||c.auth_expired){await sleep(1000);continue;}
    const row=await store.next();
    if(row&&!['uncertain','failed'].includes(row.stage)&&new Date(row.retry_at).getTime()<=Date.now()){
     if(!this.gate.acquire()){await sleep(1000);continue;}
     try{await processWeixinMessage(row,store,client,async(userId,text,key)=>{
      this.gate.registerOwner(userId);
      const result=await this.core.converse({userId:userId as UserId,text,requestId:key,traceId:randomUUID()});
      try{this.quality?.record(summarizeTurnQuality(result.trace));}catch{/* Telemetry cannot fail Core replay. */}
      try{this.performance?.record(summarizeTurnPerformance(result.trace),'weixin');}catch{/* Numeric telemetry only. */}
      return result.response;
     });}finally{this.gate.release();}
     continue;
    }
    const data=await client.post('getupdates',{get_updates_buf:c.cursor});
    if(!Array.isArray(data.msgs)||data.msgs.length>100||typeof data.get_updates_buf!=='string'||data.get_updates_buf.length>65536)throw new WeixinError('INVALID_BATCH');
    const messages=data.msgs.map(m=>extractText(m,client.credentials)).filter(m=>m!==null);
    await store.ingest(messages,data.get_updates_buf);
    await sleep(300);
   }catch(e){
    if(this.stopped)break;
    const auth=e instanceof WeixinError&&e.code==='AUTH_EXPIRED';
    await store.error(auth?'AUTH_EXPIRED':e instanceof Error&&e.message==='BACKLOG_FULL'?'BACKLOG_FULL':'CHANNEL_RETRY',auth);
    await sleep(3000);
   }
  }
 }
 async status(userId:string):Promise<unknown>{return this.store?.healthy?this.store.status(userId):{enabled:false};}
 private available(){if(!this.store?.healthy)throw Error('CHANNEL_DISABLED');return this.store;}
 bindingCode(userId:string){return this.available().bindingCode(userId);}
 control(userId:string,action:'pause'|'resume'){return this.available().control(userId,action);}
 resolve(userId:string,key:string,action:'confirm'|'retry'|'skip'){return this.available().resolve(userId,key,action);}
}
