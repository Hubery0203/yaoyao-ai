import type {WeixinStore,WeixinRow} from './store.js';
import type {WeixinImage} from './media.js';
export interface PhotoJob {state:'reserved'|'generated'|'uploaded'|'failed';artifact:string|null;media:WeixinImage|null}
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
 async save(row:WeixinRow,state:PhotoJob['state'],artifact:string|null=null,media:WeixinImage|null=null):Promise<void>{
  await this.store.tx(async db=>{const r=await db.query('UPDATE weixin_photos SET state=$4,artifact=COALESCE($5,artifact),media=COALESCE($6,media) WHERE bot_id=$1 AND message_key=$2 AND user_id=$3',[this.store.credentials.botId,row.message_key,row.user_id,state,artifact,media]);if(!r.rowCount)throw Error('PHOTO_NOT_OWNED');});
 }
 async get(row:WeixinRow):Promise<PhotoJob|undefined>{return this.store.tx(async db=>(await db.query('SELECT * FROM weixin_photos WHERE bot_id=$1 AND message_key=$2 AND user_id=$3',[this.store.credentials.botId,row.message_key,row.user_id])).rows[0]);}
}
