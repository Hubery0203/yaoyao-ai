import {createHash,randomBytes} from 'node:crypto';
import type {PoolClient} from 'pg';
import {voiceCommand,voiceTextEligible,VOICE_HELP,VOICE_LABELS,type VoiceName} from '@yaoyao/application';
import {WeixinError} from './client.js';
import type {WeixinStore,WeixinRow} from './store.js';
import type {WeixinVoiceFile} from './voice-media.js';
import type {VoiceFailureCode} from '../voice/errors.js';
export interface VoiceJob{state:'eligible'|'reserved'|'generated'|'uploaded'|'failed';voice:VoiceName;artifact:string|null;media:WeixinVoiceFile|null;failure_code:VoiceFailureCode|null;reply_hash:string;settings_version:string}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const failures:Record<VoiceFailureCode,string>={VOICE_CREDIT_EXHAUSTED:'语音服务余额不足',VOICE_RATE_LIMITED:'语音服务限流',VOICE_AUTH_FAILED:'语音服务授权不可用',VOICE_RESULT_UNKNOWN:'合成失败或结果不明，不重新收费重试',VOICE_PROVIDER_FAILED:'语音合成失败',VOICE_ARTIFACT_MISSING:'音频已过期或不可用，不重新合成'};
export class WeixinVoiceStore{
 constructor(private readonly store:WeixinStore){}
 private async owner(db:PoolClient,userId:string){const c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[this.store.credentials.botId])).rows[0];if(c?.user_id!==userId)throw Error('CHANNEL_NOT_OWNED');return c;}
 private async statusText(db:PoolClient,userId:string,limit:number,configured:boolean):Promise<string>{
  const bot=this.store.credentials.botId,s=(await db.query('SELECT * FROM weixin_voice_settings WHERE bot_id=$1 AND user_id=$2',[bot,userId])).rows[0];
  const q=(await db.query("SELECT count(*)::int n,max(attempted_at) latest,clock_timestamp() now FROM weixin_voices WHERE bot_id=$1 AND user_id=$2 AND attempted_at>clock_timestamp()-interval '24 hours'",[bot,userId])).rows[0];
  const last=(await db.query('SELECT v.state,v.failure_code,v.delivery_kind,m.stage FROM weixin_voices v JOIN weixin_messages m ON m.bot_id=v.bot_id AND m.message_key=v.message_key WHERE v.bot_id=$1 AND v.user_id=$2 ORDER BY v.created_at DESC LIMIT 1',[bot,userId])).rows[0];
  const cooldown=q.latest?Math.max(0,Math.ceil((60000-(new Date(q.now).getTime()-new Date(q.latest).getTime()))/1000)):0;
  const lastText=!last?'无':last.failure_code?failures[last.failure_code as VoiceFailureCode]:['accepted','confirmed'].includes(last.stage)?(last.delivery_kind==='audio'?'语音文件微信接口已接受，手机收取/播放需本人确认':'本条已回文字，未确认发送音频'):last.stage==='uncertain'?'发送结果不明，不自动重发':last.stage==='skipped'?'已跳过':last.state==='uploaded'?'音频已上传，等待发送':last.state==='generated'?'音频已生成，等待上传':last.state==='eligible'?'待处理':last.state==='failed'?'合成未完成，已保留文字':'合成尝试已预留，不重复收费';
  return 'AI语音：'+(s?.enabled?'已开启':'已关闭')+'；服务'+(configured?'已配置':'未配置')+'；声音 '+VOICE_LABELS[(s?.voice??'coral') as VoiceName]+'\n24小时已尝试 '+q.n+'/'+limit+'，剩余 '+Math.max(0,limit-q.n)+(cooldown?'；冷却约'+cooldown+'秒':'')+'\n最近任务：'+lastText+'\n当前发送MP3文件，非原生语音条；这是应用尝试额度，不是供应商余额。';
 }
 async command(row:WeixinRow,limit:number,configured:boolean):Promise<string|null>{
  const command=voiceCommand(row.turn_text??row.text);if(!command)return null;
  return this.store.tx(async db=>{
   const bot=this.store.credentials.botId,c=await this.owner(db,row.user_id),source=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,row.message_key])).rows[0];
   if(!source||source.user_id!==row.user_id||source.text!==row.text||(source.turn_text??source.text)!==(row.turn_text??row.text)||source.origin!=='reactive')throw Error('VOICE_COMMAND_NOT_OWNED');
   if(source.reply)return source.reply as string;
   if(!['pending','generating','ready'].includes(source.stage))throw Error('VOICE_COMMAND_INACTIVE');
   await db.query('INSERT INTO weixin_voice_settings(bot_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[bot,row.user_id]);
   const s=(await db.query('SELECT * FROM weixin_voice_settings WHERE bot_id=$1 AND user_id=$2 FOR UPDATE',[bot,row.user_id])).rows[0];if(!s)throw Error('VOICE_SETTINGS_NOT_OWNED');let reply:string;
   if(command.kind==='help')reply=VOICE_HELP;
   else if(command.kind==='status')reply=await this.statusText(db,row.user_id,limit,configured);
   else if(command.kind==='disable'){
    await db.query('UPDATE weixin_voice_settings SET enabled=false,pending_hash=NULL,pending_until=NULL,version=version+1 WHERE bot_id=$1 AND user_id=$2',[bot,row.user_id]);reply='已关闭语音，后续用文字回复。';
   }else if(command.kind==='skip'){
    await db.query("UPDATE weixin_messages m SET stage='skipped',last_error='OWNER_SKIPPED_VOICE' WHERE bot_id=$1 AND user_id=$2 AND stage IN ('pending','generating','ready','uncertain','failed') AND EXISTS(SELECT 1 FROM weixin_voices v WHERE v.bot_id=m.bot_id AND v.message_key=m.message_key)",[bot,row.user_id]);reply='已跳过未完成的语音。';
   }else if(command.kind==='voice'){
    await db.query('UPDATE weixin_voice_settings SET voice=$3,version=version+1 WHERE bot_id=$1 AND user_id=$2',[bot,row.user_id,command.voice]);reply='声音已设为 '+VOICE_LABELS[command.voice]+'。';
   }else if(command.kind==='enable'){
    if(!configured||c.paused||c.auth_expired)reply='语音服务尚不可用，先保留文字回复。';
    else if(s.enabled)reply='语音已开启。';
    else{const code=randomBytes(4).toString('hex').toUpperCase();await db.query("UPDATE weixin_voice_settings SET pending_hash=$3,pending_until=clock_timestamp()+interval '5 minutes' WHERE bot_id=$1 AND user_id=$2",[bot,row.user_id,digest('minimax:'+code)]);reply='开启后，会将新日常回复的文字发送给MiniMax合成AI语音，以MP3文件发到微信，可能产生费用；长回复仍用文字。每天最多'+limit+'次尝试，不自动重试合成。\n同意请在5分钟内发送“确认语音 '+code+'”；随时发送“关闭语音”停止。';}
   }else{
    if(!configured||c.paused||c.auth_expired)reply='语音服务尚不可用，先保留文字回复。';
    else{const r=await db.query('UPDATE weixin_voice_settings SET enabled=true,enabled_at=clock_timestamp(),pending_hash=NULL,pending_until=NULL,version=version+1 WHERE bot_id=$1 AND user_id=$2 AND pending_hash=$3 AND pending_until>clock_timestamp() RETURNING bot_id',[bot,row.user_id,digest('minimax:'+command.code)]);reply=r.rowCount?'已开启AI语音，只处理之后的新日常消息。':'确认码已失效，请重新发送“开启语音”。';}
   }
   await db.query("UPDATE weixin_messages SET reply=$3,stage='ready' WHERE bot_id=$1 AND message_key=$2",[bot,row.message_key,reply]);return reply;
  });
 }
 /** Mark only an actual Core reply while generating; control/status/proactive replies never qualify. */
 async register(row:WeixinRow,reply:string):Promise<void>{
  if(!voiceTextEligible(reply))return;
  await this.store.tx(async db=>{
   const bot=this.store.credentials.botId,c=await this.owner(db,row.user_id);if(c.paused||c.auth_expired)return;
   await db.query(`INSERT INTO weixin_voices(bot_id,message_key,user_id,reply_hash,state,voice,settings_version)
    SELECT m.bot_id,m.message_key,m.user_id,$4,'eligible',s.voice,s.version FROM weixin_messages m JOIN weixin_voice_settings s ON s.bot_id=m.bot_id AND s.user_id=m.user_id
    WHERE m.bot_id=$1 AND m.message_key=$2 AND m.user_id=$3 AND m.text=$5 AND m.stage='generating' AND m.origin='reactive' AND s.enabled AND m.created_at>=s.enabled_at AND m.source_created_ms>=floor(extract(epoch FROM s.enabled_at)*1000) ON CONFLICT DO NOTHING`,[bot,row.message_key,row.user_id,digest(reply),row.text]);
  });
 }
 async reserve(row:WeixinRow,reply:string,limit:number):Promise<{job?:VoiceJob;fresh:boolean}>{
  if(!Number.isInteger(limit)||limit<1||limit>20||!voiceTextEligible(reply))return {fresh:false};
  return this.store.tx(async db=>{
   const bot=this.store.credentials.botId,c=await this.owner(db,row.user_id);if(c.paused||c.auth_expired)return {fresh:false};
   const source=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,row.message_key])).rows[0];
   if(!source||source.user_id!==row.user_id||source.text!==row.text||source.reply!==reply||source.origin!=='reactive'||source.stage!=='ready')return {fresh:false};
   const settings=(await db.query('SELECT * FROM weixin_voice_settings WHERE bot_id=$1 AND user_id=$2',[bot,row.user_id])).rows[0];
   if(!settings?.enabled||source.source_created_ms===null||Number(source.source_created_ms)<new Date(settings.enabled_at).getTime()||new Date(source.created_at)<new Date(settings.enabled_at))return {fresh:false};
   const job=(await db.query('SELECT * FROM weixin_voices WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 FOR UPDATE',[bot,row.message_key,row.user_id])).rows[0] as VoiceJob|undefined;
   if(!job||job.reply_hash!==digest(reply))return {fresh:false};
   if(job.state!=='eligible')return {job,fresh:false};
   const budget=(await db.query("SELECT count(*)::int n,coalesce(clock_timestamp()-max(attempted_at)>=interval '60 seconds',true) cooled FROM weixin_voices WHERE bot_id=$1 AND attempted_at>clock_timestamp()-interval '24 hours'",[bot])).rows[0];if(budget.n>=limit||!budget.cooled)return {fresh:false};
   const r=await db.query("UPDATE weixin_voices SET state='reserved',attempted_at=clock_timestamp(),voice=$4,settings_version=$5 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 RETURNING *",[bot,row.message_key,row.user_id,settings.voice,settings.version]);return {job:r.rows[0],fresh:true};
  });
 }
 async save(row:WeixinRow,state:VoiceJob['state'],artifact:string|null=null,media:WeixinVoiceFile|null=null,failure:VoiceFailureCode|null=null):Promise<void>{
  if(!['generated','uploaded','failed'].includes(state))throw Error('INVALID_VOICE_TRANSITION');
  await this.store.tx(async db=>{await this.owner(db,row.user_id);const result=await db.query("UPDATE weixin_voices SET state=$4,artifact=COALESCE($5,artifact),media=COALESCE($6,media),failure_code=$7 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 AND state=ANY($8::text[])",[this.store.credentials.botId,row.message_key,row.user_id,state,artifact,media,failure,state==='generated'?['reserved']:state==='uploaded'?['generated']:['reserved','generated','uploaded','failed']]);if(!result.rowCount)throw Error('VOICE_JOB_NOT_OWNED_OR_TRANSITIONED');});
 }
 async canUpload(row:WeixinRow,reply:string):Promise<boolean>{return this.store.tx(async db=>{
  const c=await this.owner(db,row.user_id);if(c.paused||c.auth_expired)return false;
  const r=await db.query(`SELECT 1 FROM weixin_voices v JOIN weixin_voice_settings s ON s.bot_id=v.bot_id AND s.user_id=v.user_id JOIN weixin_messages m ON m.bot_id=v.bot_id AND m.message_key=v.message_key
   WHERE v.bot_id=$1 AND v.message_key=$2 AND v.user_id=$3 AND v.state='generated' AND v.reply_hash=$4 AND s.enabled AND s.version=v.settings_version AND m.stage='ready' AND m.reply=$5`,[this.store.credentials.botId,row.message_key,row.user_id,digest(reply),reply]);return !!r.rowCount;
 });}
 async sendingMedia(row:WeixinRow,reply:string,allowAudio=true):Promise<WeixinVoiceFile|undefined>{return this.store.tx(async db=>{
  const c=await this.owner(db,row.user_id);if(c.paused||c.auth_expired)throw new WeixinError('DELIVERY_STOPPED');
  const source=(await db.query('SELECT user_id,reply,stage FROM weixin_messages WHERE bot_id=$1 AND message_key=$2',[this.store.credentials.botId,row.message_key])).rows[0];if(source?.user_id!==row.user_id||source.reply!==reply||source.stage!=='sending')throw new WeixinError('DELIVERY_STOPPED');
  const r=await db.query(`SELECT v.media FROM weixin_voices v JOIN weixin_voice_settings s ON s.bot_id=v.bot_id AND s.user_id=v.user_id JOIN weixin_messages m ON m.bot_id=v.bot_id AND m.message_key=v.message_key
   WHERE v.bot_id=$1 AND v.message_key=$2 AND v.user_id=$3 AND v.state='uploaded' AND v.reply_hash=$4 AND s.enabled AND s.version=v.settings_version AND m.stage='sending' AND m.reply=$5 AND m.origin='reactive' AND $6::boolean`,[this.store.credentials.botId,row.message_key,row.user_id,digest(reply),reply,allowAudio]);
  const media=r.rows[0]?.media;await db.query('UPDATE weixin_voices SET delivery_kind=$4 WHERE bot_id=$1 AND message_key=$2 AND user_id=$3 AND reply_hash=$5',[this.store.credentials.botId,row.message_key,row.user_id,media?'audio':'text',digest(reply)]);return media;
 });}
}
