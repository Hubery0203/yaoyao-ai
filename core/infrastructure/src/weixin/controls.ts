import {randomBytes,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {parseOutreachCommand,outreachDue,reminderReference,formatMinute,validateOutreachSettings,type OutreachSettings} from '@yaoyao/application';
interface ControlStore {readonly credentials:{botId:string};tx<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>;}
const HELP='主动联系状态 / 提醒列表\n开启主动联系 / 暂停主动联系 / 关闭主动联系\n设置免打扰：22:00-08:00\n设置联系时区：Asia/Tokyo\n设置联系上限：1（或2）\n设置问候：09:00（或关闭）\n添加提醒：明天 09:00 | 记得带伞\n取消提醒 编号\n开启、设置和添加均先预览，再确认联系/取消联系。\n提醒受免打扰、额度、停聊10分钟及微信会话有效期限制，不能保证准时送达。';
function settingsText(s:OutreachSettings){return '主动联系：'+(s.enabled?'开启':'关闭')+'\n时区：'+s.timezone+'\n免打扰：'+formatMinute(s.quietStart)+'-'+formatMinute(s.quietEnd)+'\n每日/滚动24小时上限：'+s.dailyLimit+'\n问候：'+(s.greeting?formatMinute(s.greetingMinute):'关闭');}
function dateText(d:Date,zone:string){return new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);}
type Payload={kind:'settings';settings:OutreachSettings}|{kind:'add';dueAt:string;message:string;timezone:string};
export async function cancelReminder(db:PoolClient,bot:string,user:string,id:string):Promise<boolean>{
 const job=(await db.query("SELECT * FROM weixin_followups WHERE bot_id=$1 AND user_id=$2 AND id=$3 AND stage IN ('pending','queued') FOR UPDATE",[bot,user,id])).rows[0];if(!job)return false;
 if(job.message_key){const row=(await db.query('SELECT stage FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,job.message_key])).rows[0];if(row&&!['ready','skipped'].includes(row.stage))return false;await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OWNER_CANCELLED' WHERE bot_id=$1 AND message_key=$2 AND stage='ready'",[bot,job.message_key]);}
 await db.query("UPDATE weixin_followups SET stage='cancelled' WHERE bot_id=$1 AND id=$2",[bot,id]);return true;
}
/** Side effects and durable reply are committed together; only actual owner inbox rows qualify. */
export async function handleOutreachControl(store:ControlStore,user:string,text:string,key:string):Promise<string|null>{
 const cmd=parseOutreachCommand(text);if(!cmd)return null;
 return store.tx(async db=>{
  const bot=store.credentials.botId,c=(await db.query('SELECT * FROM weixin_channels WHERE bot_id=$1 FOR UPDATE',[bot])).rows[0];if(c.user_id!==user)throw Error('CHANNEL_NOT_OWNED');
  const source=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND message_key=$2 FOR UPDATE',[bot,key])).rows[0];if(!source||source.user_id!==user||source.origin!=='reactive'||source.batch_key!=null||(source.turn_text??source.text)!==text)throw Error('CONTROL_SOURCE_MISMATCH');
  const old=(await db.query('SELECT * FROM weixin_controls WHERE bot_id=$1 AND message_key=$2',[bot,key])).rows[0];if(old){if(old.text!==text||old.user_id!==user)throw Error('CONTROL_KEY_REUSED');return String(old.reply);}
  if(!['pending','generating'].includes(source.stage))throw Error('CONTROL_SOURCE_NOT_ACTIVE');
  const now=new Date((await db.query('SELECT clock_timestamp() AS now')).rows[0].now),s=c.outreach_settings as OutreachSettings;let reply=HELP,payload:Payload|null=null,code:string|null=null;
  if(cmd.type==='status')reply=settingsText(s)+(c.paused?'\n整个微信通道已暂停。':'')+(c.auth_expired?'\n微信授权已过期。':'')+'\n开启不保证准时送达；受会话、安静时段、停聊10分钟和额度限制。';
  else if(cmd.type==='list'){
   const rows=(await db.query("SELECT f.*,m.stage AS delivery_stage FROM weixin_followups f LEFT JOIN weixin_messages m ON m.bot_id=f.bot_id AND m.message_key=f.message_key WHERE f.bot_id=$1 AND f.user_id=$2 ORDER BY CASE WHEN f.stage='pending' THEN 0 WHEN f.stage='queued' AND m.stage IN ('ready','sending','uncertain','failed') THEN 1 ELSE 2 END,f.created_at DESC,f.id DESC LIMIT 25",[bot,user])).rows;
   const names:Record<string,string>={pending:'待到期',queued:'排队中',cancelled:'已取消',expired:'已过期',ready:'待发送',sending:'发送中，不能保证撤回',accepted:'接口已接受（非送达确认）',confirmed:'本人已确认',uncertain:'结果不确定，不自动重发',failed:'发送失败',skipped:'已跳过'};
   reply=rows.length?'最近25条提醒（'+s.timezone+'）：\n'+rows.map(r=>reminderReference(r.id)+' '+dateText(r.due_at,s.timezone)+' '+(r.stage==='pending'?(r.expires_at<=now?'已过期':c.outreach_since&&r.due_at<c.outreach_since?'已错过启用时间，不补发':r.due_at<=now?'已到期，等待允许联系':'待到期'):(names[r.delivery_stage??r.stage]??'未知状态'))+'\n'+(r.message.length>80?r.message.slice(0,80)+'…':r.message)).join('\n'):'目前没有提醒。';
  }else if(cmd.type==='enable'||cmd.type==='patch'){
   const next={...s,...(cmd.type==='patch'?cmd.patch:{enabled:true})};if(!validateOutreachSettings(next))reply='设置格式不对，请发“联系帮助”。';else if(JSON.stringify(next)===JSON.stringify(s))reply='已经是这个设置。';else{payload={kind:'settings',settings:next};reply='将改为：\n'+settingsText(next)+'\n开启后只处理设置生效后的到期事项；旧事项不会补发。';}
  }else if(cmd.type==='add'){
   const due=outreachDue(cmd.when,s.timezone,now);
   if(!s.enabled)reply='主动联系目前关闭；先发送“开启主动联系”并确认，再添加提醒。';
   else if(!due)reply='时间无效、已过期、超过未来30天，或该时区夏令时导致时间不存在/重复；请换一个明确时间。';
   else{payload={kind:'add',dueAt:due.toISOString(),message:cmd.message,timezone:s.timezone};reply='将添加提醒：'+dateText(due,s.timezone)+'（'+s.timezone+'）\n'+cmd.message+'\n这是尝试联系时间，受免打扰、额度及微信会话限制，不能保证准点送达。';}
  }else if(cmd.type==='cancel-reminder'){
   const matches=(await db.query("SELECT id FROM weixin_followups WHERE bot_id=$1 AND user_id=$2 AND upper(right(replace(id::text,'-',''),8))=$3",[bot,user,cmd.reference])).rows;
   reply=matches.length!==1?'编号不明确，请先看“提醒列表”。':await cancelReminder(db,bot,user,matches[0].id)?'已取消这条提醒。':'这条提醒已结束或进入发送边界，不能保证撤回；不会重新发送。';
  }else if(cmd.type==='confirm'||cmd.type==='cancel'){
   const a=(await db.query('SELECT * FROM weixin_controls WHERE bot_id=$1 AND user_id=$2 AND code=$3 FOR UPDATE',[bot,user,cmd.code])).rows[0];
   if(!a||a.status!=='pending'||a.expires_at<=now)reply='这个联系确认码已失效，请重新操作。';
   else if(cmd.type==='cancel'){await db.query("UPDATE weixin_controls SET status='cancelled' WHERE bot_id=$1 AND code=$2",[bot,cmd.code]);reply='已取消，这次不修改。';}
   else if(a.expected_version!==c.outreach_version){await db.query("UPDATE weixin_controls SET status='cancelled' WHERE bot_id=$1 AND code=$2",[bot,cmd.code]);reply='联系设置已变化，请重新查看后操作。';}
   else{
    const p=a.payload as Payload;let applied=false;
    if(p.kind==='settings'&&validateOutreachSettings(p.settings)){
     await db.query('UPDATE weixin_channels SET outreach_settings=$2,outreach_version=outreach_version+1,outreach_since=clock_timestamp() WHERE bot_id=$1',[bot,p.settings]);await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OUTREACH_SETTINGS_CHANGED' WHERE bot_id=$1 AND origin='proactive' AND stage='ready'",[bot]);reply='已更新主动联系设置。';applied=true;
    }else if(p.kind==='add'){
     const due=new Date(p.dueAt),n=(await db.query("SELECT count(*)::int n FROM weixin_followups WHERE bot_id=$1 AND stage='pending'",[bot])).rows[0].n;
     if(!s.enabled||p.timezone!==s.timezone)reply='联系已关闭或时区变化，请重新添加。';
     else if(!Number.isFinite(due.getTime())||due<=now||due.getTime()>now.getTime()+30*86400000||!p.message?.trim()||p.message.length>120)reply='提醒时间或内容已无效，请重新添加。';
     else if(n>=20)reply='最多20条待办提醒，请先取消不需要的。';
     else{const id=randomUUID();await db.query('INSERT INTO weixin_followups(id,bot_id,user_id,message,due_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[id,bot,user,p.message,due,new Date(due.getTime()+86400000)]);reply='已添加提醒 '+reminderReference(id)+'：'+dateText(due,s.timezone)+'（'+s.timezone+'）\n'+p.message+'\n受会话、免打扰和额度限制，不能保证准时送达。';applied=true;}
    }else reply='预览内容无效，请重新操作。';
    await db.query('UPDATE weixin_controls SET status=$3 WHERE bot_id=$1 AND code=$2',[bot,cmd.code,applied?'done':'cancelled']);
   }
  }
  if(payload){code=randomBytes(4).toString('hex').toUpperCase();await db.query("UPDATE weixin_controls SET status='cancelled' WHERE bot_id=$1 AND user_id=$2 AND status='pending'",[bot,user]);reply+='\n10分钟内发送“确认联系 '+code+'”生效；或“取消联系 '+code+'”。';}
  await db.query('INSERT INTO weixin_controls(bot_id,message_key,user_id,text,reply,code,payload,expected_version,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[bot,key,user,text,reply,code,payload,code?c.outreach_version:null,code?new Date(now.getTime()+600000):null,code?'pending':'receipt']);return reply;
 });
}
