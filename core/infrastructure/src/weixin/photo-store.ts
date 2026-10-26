import {photoFailureMessage,type PhotoFailureCode} from '@yaoyao/application';
import type {WeixinStore,WeixinRow} from './store.js';
import type {WeixinImage} from './media.js';
export interface PhotoJob {state:'reserved'|'generated'|'uploaded'|'failed';artifact:string|null;media:WeixinImage|null;failure_code?:PhotoFailureCode|null}
/** Uses the existing channel transaction and row lock: quotas and attempts survive restarts. */
export class WeixinPhotoStore {
 constructor(private readonly store:WeixinStore){}
 async reserve(row:WeixinRow,limit:number):Promise<{job?:PhotoJob;fresh:boolean;denied?:boolean}>{
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('INVALID_PHOTO_LIMIT');
  return this.store.tx(async db=>{
   const bot=this.store.credentials.botId,c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[bot])).rows[0];
   if(c.user_id!==row.user_id||c.paused||c.auth_expired)return {fresh:false,denied:true};
   const source=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,row.message_key])).rows[0];
   if(!source||source.user_id!==row.user_id||source.text!==row.text||source.origin!=='reactive'||!['pending','generating','ready'].includes(source.stage))return {fresh:false,denied:true};
   const prior=(await db.query('SELECT * FROM weixin_photos WHERE bot_id=$1 AND message_key=$2',[bot,row.message_key])).rows[0];if(prior)return {job:prior,fresh:false};
   const count=(await db.query("SELECT count(*)::int n,max(created_at) latest FROM weixin_photos WHERE bot_id=$1 AND created_at>clock_timestamp()-interval '24 hours'",[bot])).rows[0];
   if(count.n>=limit||count.latest&&Date.now()-new Date(count.latest).getTime()<60000)return {fresh:false,denied:true};
   const job=(await db.query("INSERT INTO weixin_photos(bot_id,message_key,user_id,state) VALUES($1,$2,$3,'reserved') RETURNING *",[bot,row.message_key,row.user_id])).rows[0];return {job,fresh:true};
  });
 }
 async save(row:WeixinRow,state:PhotoJob['state'],artifact:string|null=null,media:WeixinImage|null=null,failureCode:PhotoFailureCode|null=null):Promise<void>{
  await this.store.tx(async db=>{const r=await db.query("UPDATE weixin_photos SET state=$4,artifact=COALESCE($5,artifact),media=COALESCE($6,media),failure_code=CASE WHEN $4='failed' THEN COALESCE($7,failure_code) ELSE NULL END WHERE bot_id=$1 AND message_key=$2 AND user_id=$3",[this.store.credentials.botId,row.message_key,row.user_id,state,artifact,media,failureCode]);if(!r.rowCount)throw Error('PHOTO_NOT_OWNED');});
 }
 async status(userId:string,limit:number,enabled:boolean):Promise<string>{return this.store.tx(async db=>{
  const bot=this.store.credentials.botId,c=(await db.query('SELECT user_id,paused,auth_expired FROM weixin_channels WHERE bot_id=$1',[bot])).rows[0];if(c.user_id!==userId)throw Error('CHANNEL_NOT_OWNED');
  const count=(await db.query("SELECT count(*)::int n,max(created_at) latest,clock_timestamp() now FROM weixin_photos WHERE bot_id=$1 AND user_id=$2 AND created_at>clock_timestamp()-interval '24 hours'",[bot,userId])).rows[0];
  const cooldown=count.latest?Math.max(0,Math.ceil((60000-(new Date(count.now).getTime()-new Date(count.latest).getTime()))/1000)):0;
  const rows=(await db.query('SELECT p.state,p.failure_code,m.stage FROM weixin_photos p JOIN weixin_messages m ON m.bot_id=p.bot_id AND m.message_key=p.message_key WHERE p.bot_id=$1 AND p.user_id=$2 ORDER BY p.created_at DESC,p.message_key DESC LIMIT 3',[bot,userId])).rows;
  const stages:Record<string,string>={accepted:'微信接口已接受（非手机送达确认）',confirmed:'本人已确认',uncertain:'发送结果不明，不自动重发',failed:'发送待处理',skipped:'已跳过'};
  return '照片功能：'+(enabled?'已配置':'未启用或配置不完整')+'\n过去24小时已尝试：'+count.n+'/'+limit+'，剩余'+Math.max(0,limit-count.n)+(cooldown?'；冷却还需约'+cooldown+'秒':'')+(c.paused?'\n微信通道已暂停。':'')+(c.auth_expired?'\n微信授权已过期。':'')+'\n'+(rows.length?rows.map((r,i)=>String(i+1)+'. '+(r.state==='failed'?(r.failure_code?photoFailureMessage(r.failure_code):'生成失败或结果不明，不自动重试'):stages[r.stage]??(r.state==='uploaded'?'图片已上传，等待发送':r.state==='generated'?'图片已生成，上传待处理':'生成尝试已预留，不能重复收费重试'))).join('\n'):'还没有照片任务。')+'\n这是本应用的尝试额度，不是供应商余额。';
 });}
 async get(row:WeixinRow):Promise<PhotoJob|undefined>{return this.store.tx(async db=>(await db.query('SELECT * FROM weixin_photos WHERE bot_id=$1 AND message_key=$2 AND user_id=$3',[this.store.credentials.botId,row.message_key,row.user_id])).rows[0]);}
}
