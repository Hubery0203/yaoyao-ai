import type {WeixinStore,WeixinRow} from './store.js';
export interface VisionJob {state:'reserved'|'analyzed'|'failed';response:string|null}
export class WeixinVisionStore {
 constructor(private readonly store:WeixinStore){}
 get(row:WeixinRow):Promise<VisionJob|undefined>{return this.store.tx(async db=>(await db.query('SELECT state,response FROM weixin_vision WHERE bot_id=$1 AND message_key=$2 AND user_id=$3',[this.store.credentials.botId,row.message_key,row.user_id])).rows[0]);}
 async discardMedia(row:WeixinRow):Promise<void>{await this.store.tx(async db=>{await db.query("UPDATE weixin_messages SET incoming_image=$4 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 AND incoming_image IS NOT NULL",[this.store.credentials.botId,row.message_key,row.user_id,{status:'consumed'}]);});}
 async reserve(row:WeixinRow,limit:number,activeSinceMs:number):Promise<{job?:VisionJob;fresh:boolean;denied?:boolean}>{
  if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isSafeInteger(activeSinceMs)||activeSinceMs<=0||activeSinceMs>Date.now()+300000)throw Error('INVALID_VISION_LIMIT');
  return this.store.tx(async db=>{
   const bot=this.store.credentials.botId,c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[bot])).rows[0];
   if(c.user_id!==row.user_id||c.paused||c.auth_expired)return {fresh:false,denied:true};
   const source=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,row.message_key])).rows[0];
   if(!source||source.user_id!==row.user_id||source.text!==row.text||source.origin!=='reactive'||!['pending','generating','ready'].includes(source.stage))return {fresh:false,denied:true};
   const prior=(await db.query('SELECT state,response FROM weixin_vision WHERE bot_id=$1 AND message_key=$2',[bot,row.message_key])).rows[0];if(prior)return {job:prior,fresh:false};
   if(source.incoming_image?.status!=='ready'||row.incoming_image?.status!=='ready'||source.incoming_image.url!==row.incoming_image.url||source.incoming_image.aesKey!==row.incoming_image.aesKey||!Number.isSafeInteger(Number(source.source_created_ms))||Number(source.source_created_ms)<activeSinceMs||Number(source.source_created_ms)<Date.now()-600000)return {fresh:false,denied:true};
   const n=(await db.query("SELECT count(*)::int n,max(created_at) latest FROM weixin_vision WHERE bot_id=$1 AND created_at>clock_timestamp()-interval '24 hours'",[bot])).rows[0];
   if(n.n>=limit||n.latest&&Date.now()-new Date(n.latest).getTime()<30000)return {fresh:false,denied:true};
   const job=(await db.query("INSERT INTO weixin_vision(bot_id,message_key,user_id,state) VALUES($1,$2,$3,'reserved') RETURNING state,response",[bot,row.message_key,row.user_id])).rows[0];return {job,fresh:true};
  });
 }
 async save(row:WeixinRow,state:'analyzed'|'failed',response:string,code:string|null=null):Promise<void>{
  if(!response||response.length>2000)throw Error('INVALID_VISION_REPLY');
  await this.store.tx(async db=>{
   const bot=this.store.credentials.botId,r=await db.query("UPDATE weixin_vision SET state=$4,response=$5,failure_code=$6 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 AND state='reserved'",[bot,row.message_key,row.user_id,state,response,code]);
   if(!r.rowCount)throw Error('VISION_NOT_RESERVED');
   await db.query("UPDATE weixin_messages SET incoming_image=$4 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3",[bot,row.message_key,row.user_id,{status:'consumed'}]);
  });
 }
 async status(userId:string,limit:number,enabled:boolean):Promise<string>{return this.store.tx(async db=>{
  const bot=this.store.credentials.botId,c=(await db.query('SELECT user_id FROM weixin_channels WHERE bot_id=$1',[bot])).rows[0];if(c.user_id!==userId)throw Error('CHANNEL_NOT_OWNED');
  const count=(await db.query("SELECT count(*)::int n FROM weixin_vision WHERE bot_id=$1 AND user_id=$2 AND created_at>clock_timestamp()-interval '24 hours'",[bot,userId])).rows[0].n;
  return '看图功能：'+(enabled?'已配置':'暂未配置')+'\n过去24小时已尝试：'+count+'/'+limit+'，剩余'+Math.max(0,limit-count)+'\n失败及结果不明也计入；单次最多一张，不自动重试。';
 });}
}
