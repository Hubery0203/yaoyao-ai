import {Client,type Pool,type PoolClient} from 'pg';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {batchIsReady,isReplyCancellation,isOutreachStop,localOutreachClock,isQuietMinute,validateOutreachSettings,type OutreachSettings} from '@yaoyao/application';
import type {IncomingText,WeixinCredentials} from './client.js';
export interface WeixinRow {message_key:string;user_id:string;text:string;context_token:string;reply:string|null;stage:string;attempts:number;retry_at:Date;turn_text?:string|null;batch_key?:string|null;origin?:'reactive'|'proactive';created_at?:Date}
export class WeixinStore {
 private lock:Client|null=null;healthy=false;
 constructor(private readonly pool:Pool,readonly credentials:WeixinCredentials,private readonly connectionString:string){}
 async open():Promise<void>{
  const client=new Client({connectionString:this.connectionString,application_name:'yaoyao-weixin-lock'});
  client.on('error',()=>{this.healthy=false;});client.on('end',()=>{this.healthy=false;});
  this.lock=client;await client.connect();
  const result=await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",['yaoyao-weixin:'+this.credentials.botId]);
  if(!result.rows[0].locked){await client.end();throw Error('CHANNEL_ALREADY_RUNNING');}this.healthy=true;
  await this.tx(async db=>{
   await db.query('INSERT INTO weixin_channels(bot_id,peer_id,cutoff_ms,credential_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[this.credentials.botId,this.credentials.ownerId,Date.now(),createHash('sha256').update(this.credentials.token).digest('hex')]);
   const {rows}=await db.query('SELECT peer_id FROM weixin_channels WHERE bot_id=$1',[this.credentials.botId]);
   if(rows[0]?.peer_id!==this.credentials.ownerId)throw Error('CHANNEL_IDENTITY_CHANGED');
   await db.query("UPDATE weixin_channels SET auth_expired=false,credential_version=$2 WHERE bot_id=$1 AND credential_version<>$2",[this.credentials.botId,createHash('sha256').update(this.credentials.token).digest('hex')]);
   await db.query("UPDATE weixin_messages SET stage='uncertain',last_error='RESTART_DURING_SEND',updated_at=clock_timestamp() WHERE bot_id=$1 AND stage='sending'",[this.credentials.botId]);
   await db.query("UPDATE weixin_messages SET stage='pending' WHERE bot_id=$1 AND stage='generating'",[this.credentials.botId]);
  });
 }
 async close():Promise<void>{this.healthy=false;await this.lock?.end().catch(()=>undefined);this.lock=null;}
 async tx<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>{
  if(!this.healthy)throw Error('CHANNEL_NOT_RUNNING');
  const db=await this.pool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.weixin_bot_id',$1,true)",[this.credentials.botId]);const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e;}finally{db.release();}
 }
 channel(){return this.tx(async db=>(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1',[this.credentials.botId])).rows[0]);}
 async ingest(messages:IncomingText[],cursor:string):Promise<void>{
  await this.tx(async db=>{
   const c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
   for(const m of messages){
    if(m.time<Number(c.cutoff_ms)||m.time>Date.now()+300000)continue;
    if((await db.query('SELECT 1 FROM weixin_messages WHERE bot_id=$1 AND message_key=$2',[this.credentials.botId,m.key])).rowCount)continue;
    let reply:string|null=null;
    if(isReplyCancellation(m.text)||isOutreachStop(m.text)){
     if(!c.user_id)continue;
     if(isOutreachStop(m.text))await db.query(`UPDATE weixin_channels SET outreach_settings=jsonb_set(outreach_settings,'{enabled}','false'),outreach_version=outreach_version+1 WHERE bot_id=$1`,[this.credentials.botId]);
     await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OWNER_CANCELLED',updated_at=clock_timestamp() WHERE bot_id=$1 AND stage IN ('pending','generating','ready') AND (origin='proactive' OR $2)",[this.credentials.botId,isReplyCancellation(m.text)]);
     await db.query("INSERT INTO weixin_messages(bot_id,message_key,user_id,text,context_token,stage) VALUES($1,$2,$3,$4,$5,'skipped')",[this.credentials.botId,m.key,c.user_id,m.text,m.contextToken]);
     await db.query("UPDATE weixin_channels SET last_context_token=CASE WHEN last_inbound_at IS NULL OR last_inbound_at<=$3 THEN $2 ELSE last_context_token END,last_inbound_at=GREATEST(last_inbound_at,$3) WHERE bot_id=$1",[this.credentials.botId,m.contextToken,new Date(Math.min(m.time,Date.now()))]);
     continue;
    }
    const match=/^绑定\s+([A-F0-9]{16})$/i.exec(m.text.trim());
    if(match){
     const hash=createHash('sha256').update(match[1].toUpperCase()).digest('hex');
     const code=(await db.query('DELETE FROM weixin_binding_codes WHERE bot_id=$1 AND code_hash=$2 AND expires_at>clock_timestamp() RETURNING user_id',[this.credentials.botId,hash])).rows[0];
     if(!code||c.user_id&&c.user_id!==code.user_id)continue;
     c.user_id=code.user_id;
     await db.query('UPDATE weixin_channels SET user_id=$2 WHERE bot_id=$1',[this.credentials.botId,c.user_id]);
     reply='遥遥 AI 已绑定你的账号。现在可以在这里和我聊天，网页和微信会共用对话与记忆。';
    }
    if(!c.user_id)continue;
    // Fresh user activity takes priority over a scheduled, not-yet-sent message.
    await db.query("UPDATE weixin_messages SET stage='skipped',last_error='USER_ACTIVE' WHERE bot_id=$1 AND origin='proactive' AND stage='ready'",[this.credentials.botId]);
    await db.query("UPDATE weixin_channels SET last_context_token=CASE WHEN last_inbound_at IS NULL OR last_inbound_at<=$3 THEN $2 ELSE last_context_token END,last_inbound_at=GREATEST(last_inbound_at,$3) WHERE bot_id=$1",[this.credentials.botId,m.contextToken,new Date(Math.min(m.time,Date.now()))]);
    await db.query('INSERT INTO weixin_messages(bot_id,message_key,user_id,text,context_token,reply,stage) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.credentials.botId,m.key,c.user_id,m.text,m.contextToken,reply,reply?'ready':'pending']);
   }
   const count=(await db.query("SELECT count(*)::int AS n FROM weixin_messages WHERE bot_id=$1 AND stage NOT IN ('accepted','confirmed','skipped')",[this.credentials.botId])).rows[0].n;
   if(count>100)throw Error('BACKLOG_FULL');
   await db.query('UPDATE weixin_channels SET cursor=$2,last_error=NULL,updated_at=clock_timestamp() WHERE bot_id=$1',[this.credentials.botId,cursor]);
  });
 }
 next():Promise<WeixinRow|undefined>{return this.tx(async db=>(await db.query("SELECT * FROM weixin_messages WHERE bot_id=$1 AND batch_key IS NULL AND stage NOT IN ('accepted','confirmed','skipped') ORDER BY ordinal LIMIT 1",[this.credentials.botId])).rows[0]);}
 async update(key:string,stage:string,options:{reply?:string;error?:string;ack?:string;delay?:number;attempt?:boolean}={}):Promise<void>{
  await this.tx(async db=>{await db.query('UPDATE weixin_messages SET stage=$3,reply=COALESCE($4,reply),last_error=$5,ack_level=COALESCE($6,ack_level),retry_at=clock_timestamp()+$7*interval \'1 millisecond\',attempts=attempts+$8,updated_at=clock_timestamp() WHERE bot_id=$1 AND (message_key=$2 OR batch_key=$2) AND stage<>\'skipped\'',[this.credentials.botId,key,stage,options.reply??null,options.error??null,options.ack??null,options.delay??0,options.attempt?1:0]);});
 }
 async error(code:string,auth=false):Promise<void>{await this.tx(async db=>{await db.query('UPDATE weixin_channels SET last_error=$2,auth_expired=auth_expired OR $3 WHERE bot_id=$1',[this.credentials.botId,code,auth]);});}
 async status(userId:string):Promise<unknown>{return this.tx(async db=>{
  const c=(await db.query('SELECT user_id,paused,auth_expired,last_error,cutoff_ms,updated_at,outreach_settings FROM weixin_channels WHERE bot_id=$1',[this.credentials.botId])).rows[0];
  if(c.user_id!==userId)return c.user_id?{enabled:true,bound:false,available:false}:{enabled:true,bound:false,available:true,authExpired:c.auth_expired,error:c.last_error};
  const {rows}=await db.query("SELECT message_key AS key,stage,attempts,last_error AS error,ack_level AS acknowledgement,created_at,updated_at FROM weixin_messages WHERE bot_id=$1 AND user_id=$2 AND batch_key IS NULL ORDER BY (stage IN ('uncertain','failed')) DESC,ordinal DESC LIMIT 30",[this.credentials.botId,userId]);
  const followups=(await db.query('SELECT f.id,f.message,f.due_at,f.expires_at,f.stage,m.stage AS delivery_stage FROM weixin_followups f LEFT JOIN weixin_messages m ON m.bot_id=f.bot_id AND m.message_key=f.message_key WHERE f.bot_id=$1 AND f.user_id=$2 ORDER BY f.created_at DESC LIMIT 30',[this.credentials.botId,userId])).rows;
  return {outreach:c.outreach_settings,followups,enabled:true,bound:true,paused:c.paused,authExpired:c.auth_expired,error:c.last_error,since:new Date(Number(c.cutoff_ms)).toISOString(),deliveries:rows};
 });}
 async bindingCode(userId:string):Promise<{code:string;expiresAt:string}>{
  const code=randomBytes(8).toString('hex').toUpperCase();const expiresAt=new Date(Date.now()+600000).toISOString();
  await this.tx(async db=>{
   const c=(await db.query('SELECT user_id FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
   if(c.user_id&&c.user_id!==userId)throw Error('CHANNEL_ALREADY_BOUND');
   await db.query('DELETE FROM weixin_binding_codes WHERE bot_id=$1 AND (user_id=$2 OR expires_at<clock_timestamp())',[this.credentials.botId,userId]);
   await db.query('INSERT INTO weixin_binding_codes(code_hash,bot_id,user_id,expires_at) VALUES($1,$2,$3,$4)',[createHash('sha256').update(code).digest('hex'),this.credentials.botId,userId,expiresAt]);
  });return {code,expiresAt};
 }
 async control(userId:string,action:'pause'|'resume'):Promise<void>{await this.tx(async db=>{
  const r=await db.query('UPDATE weixin_channels SET paused=$3 WHERE bot_id=$1 AND user_id=$2 RETURNING bot_id',[this.credentials.botId,userId,action==='pause']);if(!r.rowCount)throw Error('CHANNEL_NOT_OWNED');
 });}
 async resolve(userId:string,key:string,action:'confirm'|'retry'|'skip'):Promise<void>{await this.tx(async db=>{
  const stages=action==='retry'?['uncertain','failed']:action==='confirm'?['uncertain']:['uncertain','failed'];
  const r=await db.query('UPDATE weixin_messages SET stage=$4,attempts=0,retry_at=clock_timestamp(),last_error=NULL WHERE bot_id=$1 AND user_id=$2 AND message_key=$3 AND stage=ANY($5::text[]) RETURNING message_key',[this.credentials.botId,userId,key,action==='confirm'?'confirmed':action==='skip'?'skipped':'ready',stages]);
  if(!r.rowCount)throw Error('DELIVERY_NOT_RESOLVABLE');
  // Failed generation has no reply: retry must run the same idempotent core turn.
  await db.query('UPDATE weixin_messages SET stage=$3 WHERE bot_id=$1 AND batch_key=$2',[this.credentials.botId,key,action==='confirm'?'confirmed':action==='skip'?'skipped':'ready']);
  if(action==='retry')await db.query("UPDATE weixin_messages SET stage='pending' WHERE bot_id=$1 AND message_key=$2 AND reply IS NULL",[this.credentials.botId,key]);
 });}
 /** Seal a durable burst once; retries/restarts reuse its immutable text and key. */
 async claimBatch(now=new Date()):Promise<WeixinRow|undefined>{return this.tx(async db=>{
  const c=(await db.query('SELECT paused,auth_expired FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
  if(c.paused||c.auth_expired)return;
  const rows=(await db.query("SELECT * FROM weixin_messages WHERE bot_id=$1 AND batch_key IS NULL AND stage NOT IN ('accepted','confirmed','skipped') ORDER BY ordinal LIMIT 10 FOR UPDATE",[this.credentials.botId])).rows;
  const first=rows[0];if(!first)return;
  if(first.stage!=='pending'||first.reply||first.turn_text)return first;
  const batch=[first];let text=first.text;
  for(const row of rows.slice(1)){
   if(row.stage!=='pending'||row.reply||row.turn_text||row.origin!=='reactive'||row.user_id!==first.user_id||text.length+1+row.text.length>4000||row.created_at-first.created_at>6000)break;
   batch.push(row);text+='\n'+row.text;
  }
  if(!batchIsReady(first.created_at,batch.at(-1)!.created_at,now))return;
  const latest=batch.at(-1)!;
  await db.query('UPDATE weixin_messages SET turn_text=$3,context_token=$4 WHERE bot_id=$1 AND message_key=$2',[this.credentials.botId,first.message_key,text,latest.context_token]);
  for(const row of batch.slice(1))await db.query('UPDATE weixin_messages SET batch_key=$3 WHERE bot_id=$1 AND message_key=$2',[this.credentials.botId,row.message_key,first.message_key]);
  return {...first,turn_text:text,context_token:latest.context_token};
 });}
 /** Last atomic cancellation/pause check before entering the uncertain send boundary. */
 async beginSend(key:string):Promise<boolean>{return this.tx(async db=>{
  const c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
  if(c.paused||c.auth_expired)return false;
  const row=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[this.credentials.botId,key])).rows[0];
  if(!row||row.stage!=='ready')return false;
  if(row.origin==='proactive'){
   const now=new Date(),s=c.outreach_settings as OutreachSettings,clock=localOutreachClock(now,s.timezone);
   if(!s.enabled||row.outreach_version!==c.outreach_version||isQuietMinute(clock.minute,s)||clock.day!==row.outreach_day||now.getTime()-row.created_at.getTime()>1800000||!c.last_inbound_at||now.getTime()-c.last_inbound_at.getTime()>=86400000){
    await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OUTREACH_NO_LONGER_ELIGIBLE' WHERE bot_id=$1 AND message_key=$2",[this.credentials.botId,key]);return false;
   }
  }
  await db.query("UPDATE weixin_messages SET stage='sending',send_attempted=true,attempts=attempts+1,updated_at=clock_timestamp() WHERE bot_id=$1 AND message_key=$2",[this.credentials.botId,key]);return true;
 });}
 async settings(userId:string,settings:OutreachSettings):Promise<void>{
  if(!validateOutreachSettings(settings))throw Error('INVALID_OUTREACH_SETTINGS');
  await this.tx(async db=>{
   const r=await db.query('UPDATE weixin_channels SET outreach_settings=$3,outreach_version=outreach_version+1,outreach_since=clock_timestamp() WHERE bot_id=$1 AND user_id=$2 RETURNING bot_id',[this.credentials.botId,userId,settings]);
   if(!r.rowCount)throw Error('CHANNEL_NOT_OWNED');
   await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OUTREACH_SETTINGS_CHANGED' WHERE bot_id=$1 AND origin='proactive' AND stage='ready'",[this.credentials.botId]);
  });
 }
 async followup(userId:string,message:string,dueAt:string):Promise<{id:string}>{
  const due=new Date(dueAt),now=Date.now();
  if(!message.trim()||message.length>120||!Number.isFinite(due.getTime())||due.getTime()<=now||due.getTime()>now+30*86400000)throw Error('INVALID_FOLLOWUP');
  const id=randomUUID();await this.tx(async db=>{
   const c=(await db.query('SELECT user_id,outreach_settings FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
   if(c.user_id!==userId)throw Error('CHANNEL_NOT_OWNED');
   if(!c.outreach_settings.enabled)throw Error('OUTREACH_DISABLED');
   const n=(await db.query("SELECT count(*)::int n FROM weixin_followups WHERE bot_id=$1 AND stage='pending'",[this.credentials.botId])).rows[0].n;
   if(n>=20)throw Error('TOO_MANY_FOLLOWUPS');
   await db.query('INSERT INTO weixin_followups(id,bot_id,user_id,message,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,this.credentials.botId,userId,message.trim(),due,new Date(due.getTime()+86400000)]);
  });return {id};
 }
 async cancelFollowup(userId:string,id:string):Promise<void>{await this.tx(async db=>{
  const c=(await db.query('SELECT user_id FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
  if(c.user_id!==userId)throw Error('CHANNEL_NOT_OWNED');
  const job=(await db.query("SELECT * FROM weixin_followups WHERE bot_id=$1 AND user_id=$2 AND id=$3 AND stage IN ('pending','queued') FOR UPDATE",[this.credentials.botId,userId,id])).rows[0];
  if(!job)throw Error('FOLLOWUP_NOT_CANCELLABLE');
  if(job.message_key){
   const row=(await db.query('SELECT stage FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[this.credentials.botId,job.message_key])).rows[0];
   if(row&&!['ready','skipped'].includes(row.stage))throw Error('FOLLOWUP_ALREADY_SENDING');
   await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OWNER_CANCELLED' WHERE bot_id=$1 AND message_key=$2 AND stage='ready'",[this.credentials.botId,job.message_key]);
  }
  await db.query("UPDATE weixin_followups SET stage='cancelled' WHERE bot_id=$1 AND id=$2",[this.credentials.botId,id]);
 });}

 /** Called only after a successful recent poll. Reservations, limits and due selection commit together. */
 async scheduleOutreach(now=new Date()):Promise<void>{await this.tx(async db=>{
  const c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.credentials.botId])).rows[0];
  const s=c.outreach_settings as OutreachSettings,clock=localOutreachClock(now,s.timezone),bot=this.credentials.botId;
  await db.query("UPDATE weixin_followups SET stage='expired' WHERE bot_id=$1 AND stage='pending' AND expires_at<=$2",[bot,now]);
  if(!s.enabled||!c.user_id||c.paused||c.auth_expired||isQuietMinute(clock.minute,s)||!c.last_context_token||!c.last_inbound_at)return;
  const idle=now.getTime()-c.last_inbound_at.getTime();if(idle<600000||idle>=86400000)return;
  if((await db.query("SELECT 1 FROM weixin_messages WHERE bot_id=$1 AND batch_key IS NULL AND stage NOT IN ('accepted','confirmed','skipped') LIMIT 1",[bot])).rowCount)return;
  const n=(await db.query("SELECT count(*) FILTER(WHERE outreach_day=$2)::int daily,count(*) FILTER(WHERE created_at>$3)::int rolling FROM weixin_messages WHERE bot_id=$1 AND origin='proactive' AND (stage<>'skipped' OR send_attempted) AND (outreach_day=$2 OR created_at>$3)",[bot,clock.day,new Date(now.getTime()-86400000)])).rows[0];
  if(n.daily>=s.dailyLimit||n.rolling>=s.dailyLimit)return;
  const job=(await db.query("SELECT * FROM weixin_followups WHERE bot_id=$1 AND stage='pending' AND due_at<=$2 AND expires_at>$2 AND due_at>= $3 ORDER BY due_at,id LIMIT 1 FOR UPDATE",[bot,now,c.outreach_since])).rows[0];
  let reason:string,message:string;
  if(job){reason='followup:'+job.id;message=job.message;}
  else {
   if(!s.greeting||clock.minute<s.greetingMinute||clock.minute>=s.greetingMinute+30)return;
   reason='greeting:'+clock.day;
   if((await db.query('SELECT 1 FROM weixin_messages WHERE bot_id=$1 AND outreach_reason=$2 LIMIT 1',[bot,reason])).rowCount)return;
   message=clock.minute<720?'早呀，今天也想跟你说声早安～':'想起你了，来跟你打个招呼～';
  }
  const key=createHash('sha256').update(JSON.stringify([bot,'outreach',reason])).digest('hex');
  await db.query("INSERT INTO weixin_messages(bot_id,message_key,user_id,text,context_token,reply,stage,origin,outreach_version,outreach_day,outreach_reason) VALUES($1,$2,$3,'',$4,$5,'ready','proactive',$6,$7,$8) ON CONFLICT DO NOTHING",[bot,key,c.user_id,c.last_context_token,message,c.outreach_version,clock.day,reason]);
  if(job)await db.query("UPDATE weixin_followups SET stage='queued',message_key=$3 WHERE bot_id=$1 AND id=$2",[bot,job.id,key]);
 });}
 async nextOutreachHistory():Promise<WeixinRow|undefined>{return this.tx(async db=>(await db.query("SELECT * FROM weixin_messages WHERE bot_id=$1 AND origin='proactive' AND stage IN ('accepted','confirmed') AND NOT history_recorded ORDER BY ordinal LIMIT 1",[this.credentials.botId])).rows[0]);}
 async outreachHistoryRecorded(key:string):Promise<void>{await this.tx(async db=>{await db.query('UPDATE weixin_messages SET history_recorded=true WHERE bot_id=$1 AND message_key=$2',[this.credentials.botId,key]);});}
}
