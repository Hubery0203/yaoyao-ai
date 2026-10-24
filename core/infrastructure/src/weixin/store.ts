import {Client,type Pool,type PoolClient} from 'pg';
import {randomBytes,createHash} from 'node:crypto';
import type {IncomingText,WeixinCredentials} from './client.js';
export interface WeixinRow {message_key:string;user_id:string;text:string;context_token:string;reply:string|null;stage:string;attempts:number;retry_at:Date}
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
    await db.query('INSERT INTO weixin_messages(bot_id,message_key,user_id,text,context_token,reply,stage) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.credentials.botId,m.key,c.user_id,m.text,m.contextToken,reply,reply?'ready':'pending']);
   }
   const count=(await db.query("SELECT count(*)::int AS n FROM weixin_messages WHERE bot_id=$1 AND stage NOT IN ('accepted','confirmed','skipped')",[this.credentials.botId])).rows[0].n;
   if(count>100)throw Error('BACKLOG_FULL');
   await db.query('UPDATE weixin_channels SET cursor=$2,last_error=NULL,updated_at=clock_timestamp() WHERE bot_id=$1',[this.credentials.botId,cursor]);
  });
 }
 next():Promise<WeixinRow|undefined>{return this.tx(async db=>(await db.query("SELECT * FROM weixin_messages WHERE bot_id=$1 AND stage NOT IN ('accepted','confirmed','skipped') ORDER BY ordinal LIMIT 1",[this.credentials.botId])).rows[0]);}
 async update(key:string,stage:string,options:{reply?:string;error?:string;ack?:string;delay?:number;attempt?:boolean}={}):Promise<void>{
  await this.tx(async db=>{await db.query('UPDATE weixin_messages SET stage=$3,reply=COALESCE($4,reply),last_error=$5,ack_level=COALESCE($6,ack_level),retry_at=clock_timestamp()+$7*interval \'1 millisecond\',attempts=attempts+$8,updated_at=clock_timestamp() WHERE bot_id=$1 AND message_key=$2',[this.credentials.botId,key,stage,options.reply??null,options.error??null,options.ack??null,options.delay??0,options.attempt?1:0]);});
 }
 async error(code:string,auth=false):Promise<void>{await this.tx(async db=>{await db.query('UPDATE weixin_channels SET last_error=$2,auth_expired=auth_expired OR $3 WHERE bot_id=$1',[this.credentials.botId,code,auth]);});}
 async status(userId:string):Promise<unknown>{return this.tx(async db=>{
  const c=(await db.query('SELECT user_id,paused,auth_expired,last_error,cutoff_ms,updated_at FROM weixin_channels WHERE bot_id=$1',[this.credentials.botId])).rows[0];
  if(c.user_id!==userId)return c.user_id?{enabled:true,bound:false,available:false}:{enabled:true,bound:false,available:true,authExpired:c.auth_expired,error:c.last_error};
  const {rows}=await db.query("SELECT message_key AS key,stage,attempts,last_error AS error,ack_level AS acknowledgement,created_at,updated_at FROM weixin_messages WHERE bot_id=$1 AND user_id=$2 ORDER BY (stage IN ('uncertain','failed')) DESC,ordinal DESC LIMIT 30",[this.credentials.botId,userId]);
  return {enabled:true,bound:true,paused:c.paused,authExpired:c.auth_expired,error:c.last_error,since:new Date(Number(c.cutoff_ms)).toISOString(),deliveries:rows};
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
  if(action==='retry')await db.query("UPDATE weixin_messages SET stage='pending' WHERE bot_id=$1 AND message_key=$2 AND reply IS NULL",[this.credentials.botId,key]);
 });}
}
