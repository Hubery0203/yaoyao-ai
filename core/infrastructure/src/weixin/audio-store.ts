import type {WeixinStore,WeixinRow} from './store.js';
export interface AudioJob {state:'reserved'|'transcribed'|'failed';source:'weixin'|'minimax';transcript:string|null}
const fields=['status','url','aesKey','codec','sampleRate','durationMs','nativeText'] as const;
export class WeixinAudioStore {
 constructor(private readonly store:WeixinStore){}
 get(row:WeixinRow):Promise<AudioJob|undefined>{return this.store.tx(async db=>(await db.query('SELECT state,source,transcript FROM weixin_audio WHERE bot_id=$1 AND message_key=$2 AND user_id=$3',[this.store.credentials.botId,row.message_key,row.user_id])).rows[0]);}
 async discardMedia(row:WeixinRow):Promise<void>{await this.store.tx(async db=>{await db.query('UPDATE weixin_messages SET incoming_audio=$4 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 AND incoming_audio IS NOT NULL',[this.store.credentials.botId,row.message_key,row.user_id,{status:'consumed'}]);});}
 async reserve(row:WeixinRow,limit:number,activeSinceMs:number,source:'weixin'|'minimax'):Promise<{job?:AudioJob;fresh:boolean;denied?:boolean}>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>20||!Number.isSafeInteger(activeSinceMs)||activeSinceMs<=0||activeSinceMs>Date.now()+300000)throw Error('INVALID_ASR_LIMIT');
  return this.store.tx(async db=>{
   const bot=this.store.credentials.botId,c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[bot])).rows[0];if(c.user_id!==row.user_id||c.paused||c.auth_expired)return {fresh:false,denied:true};
   const m=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,row.message_key])).rows[0];
   if(!m||m.user_id!==row.user_id||m.text!==row.text||m.origin!=='reactive'||!['pending','generating','ready'].includes(m.stage))return {fresh:false,denied:true};
   const prior=(await db.query('SELECT state,source,transcript FROM weixin_audio WHERE bot_id=$1 AND message_key=$2',[bot,row.message_key])).rows[0];if(prior)return {job:prior,fresh:false};
   if(!row.incoming_audio||!m.incoming_audio||!fields.every(k=>m.incoming_audio[k]===row.incoming_audio![k])||!Number.isSafeInteger(Number(m.source_created_ms))||Number(m.source_created_ms)<activeSinceMs||Number(m.source_created_ms)<Date.now()-600000)return {fresh:false,denied:true};
   if(source==='weixin'){
    const text=m.incoming_audio.nativeText;if(m.incoming_audio.status!=='native'||typeof text!=='string'||!text||text.length>2000)return {fresh:false,denied:true};
    const job=(await db.query("INSERT INTO weixin_audio(bot_id,message_key,user_id,state,source,transcript) VALUES($1,$2,$3,'transcribed','weixin',$4) RETURNING state,source,transcript",[bot,row.message_key,row.user_id,text])).rows[0];
    await db.query('UPDATE weixin_messages SET incoming_audio=$3 WHERE bot_id=$1 AND message_key=$2',[bot,row.message_key,{status:'consumed'}]);return {job,fresh:true};
   }
   if(m.incoming_audio.status!=='ready')return {fresh:false,denied:true};const n=(await db.query("SELECT count(*)::int n FROM weixin_audio WHERE bot_id=$1 AND attempted_at>clock_timestamp()-interval '24 hours'",[bot])).rows[0].n;if(n>=limit)return {fresh:false,denied:true};
   const job=(await db.query("INSERT INTO weixin_audio(bot_id,message_key,user_id,state,source,attempted_at) VALUES($1,$2,$3,'reserved','minimax',clock_timestamp()) RETURNING state,source,transcript",[bot,row.message_key,row.user_id])).rows[0];return {job,fresh:true};
  });
 }
 async save(row:WeixinRow,state:'transcribed'|'failed',transcript:string|null=null,code:string|null=null):Promise<void>{
  if(state==='transcribed'&&(!transcript||transcript.length>2000))throw Error('INVALID_ASR_TRANSCRIPT');
  await this.store.tx(async db=>{
   const bot=this.store.credentials.botId,r=await db.query("UPDATE weixin_audio SET state=$4,transcript=$5,failure_code=$6 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 AND state='reserved'",[bot,row.message_key,row.user_id,state,transcript,code]);if(!r.rowCount)throw Error('AUDIO_NOT_RESERVED');
   await db.query('UPDATE weixin_messages SET incoming_audio=$4 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3',[bot,row.message_key,row.user_id,{status:'consumed'}]);
  });
 }
 async status(userId:string,limit:number,enabled:boolean):Promise<string>{return this.store.tx(async db=>{
  const bot=this.store.credentials.botId,c=(await db.query('SELECT user_id FROM weixin_channels WHERE bot_id=$1',[bot])).rows[0];if(c.user_id!==userId)throw Error('CHANNEL_NOT_OWNED');const n=(await db.query("SELECT count(*)::int n FROM weixin_audio WHERE bot_id=$1 AND user_id=$2 AND attempted_at>clock_timestamp()-interval '24 hours'",[bot,userId])).rows[0].n;
  return '语音输入：'+(enabled?'已配置':'尚未开启或配置不完整')+'\n24小时识别尝试 '+n+'/'+limit+'；微信已有转写不计MiniMax识别次数。\n单段最多30秒，不保存原录音；失败或结果不明不自动重试。回复合成沿用原语音开关、音色和额度。';
 });}
}
