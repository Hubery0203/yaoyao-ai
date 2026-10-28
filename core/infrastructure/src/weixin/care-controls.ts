import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {CARE_WINDOW_MS,careMessage,normalizeCareTopic,reminderReference,type OutreachSettings} from '@yaoyao/application';
export interface CarePayload {kind:'care';dueAt:string;topic:string;timezone:string}
/** An explicit owner action ends waiting; it never recalls or retries an uncertain send. */
export async function endCare(db:PoolClient,bot:string,user:string,id:string):Promise<string>{
 const job=(await db.query("SELECT * FROM weixin_followups WHERE bot_id=$1 AND user_id=$2 AND id=$3 AND kind='care' FOR UPDATE",[bot,user,id])).rows[0];
 if(!job||['cancelled','expired'].includes(job.stage))return '这条关心已经结束，不会再联系。';
 if(job.message_key){
  const m=(await db.query('SELECT * FROM weixin_messages WHERE bot_id=$1 AND user_id=$2 AND message_key=$3 FOR UPDATE',[bot,user,job.message_key])).rows[0];
  if(!m)return '发送记录不完整，先保留原状态，不会重新发送。';
  if(m.stage==='sending')return '这条关心正在发送，不能保证撤回；结果不明时不会自动重发。';
  if(m.stage==='accepted')return '这条关心已获微信接口接受，手机是否收到尚未确认；不会继续催问。';
  if(m.stage==='confirmed')return '这条关心已确认收到，不会继续催问。';
  if(['uncertain','failed'].includes(m.stage)){
   await db.query("UPDATE weixin_messages SET stage='skipped',last_error=$4,updated_at=clock_timestamp() WHERE bot_id=$1 AND user_id=$2 AND message_key=$3",[bot,user,m.message_key,'OWNER_ENDED_CARE_'+m.stage.toUpperCase()+':'+(m.last_error??'')]);
   await db.query("UPDATE weixin_followups SET stage='cancelled' WHERE bot_id=$1 AND id=$2",[bot,id]);
   return '已结束这条关心的等待。原发送记录和额度保留，不能保证撤回；不会重发。';
  }
  if(!['ready','skipped'].includes(m.stage))return '这条关心的发送状态需要确认，先不修改或重发。';
  await db.query("UPDATE weixin_messages SET stage='skipped',last_error='OWNER_CANCELLED' WHERE bot_id=$1 AND message_key=$2 AND stage='ready'",[bot,m.message_key]);
 }
 await db.query("UPDATE weixin_followups SET stage='cancelled' WHERE bot_id=$1 AND id=$2",[bot,id]);
 return '已取消这条关心事项。';
}
/** Called under the owning channel lock; creation and the control receipt share a transaction. */
export async function confirmCare(db:PoolClient,bot:string,user:string,p:CarePayload,s:OutreachSettings,now:Date):Promise<{reply:string;applied:boolean}>{
 const due=new Date(p.dueAt),topic=normalizeCareTopic(p.topic);
 const rejected=(reply:string)=>({reply,applied:false});
 if(!s.enabled||p.timezone!==s.timezone)return rejected('联系已关闭或时区变化，请重新添加关心事项。');
 if(!Number.isFinite(due.getTime())||due<=now||due.getTime()>now.getTime()+30*86400000||!topic||topic!==p.topic)return rejected('关心时间或主题已无效，请重新添加。');
 const active=(await db.query("SELECT f.care_topic FROM weixin_followups f LEFT JOIN weixin_messages m ON m.bot_id=f.bot_id AND m.message_key=f.message_key WHERE f.bot_id=$1 AND f.user_id=$2 AND f.kind='care' AND ((f.stage='pending' AND f.expires_at>$3) OR (f.stage='queued' AND m.stage IN ('ready','sending','uncertain')))",[bot,user,now])).rows;
 if(active.some(r=>r.care_topic===topic))return rejected('这件事已经在关心列表里了，不重复添加。');
 if(active.length>=3)return rejected('最多保留3件待关心事项，先结束不需要的吧。');
 const pending=(await db.query("SELECT count(*)::int n FROM weixin_followups WHERE bot_id=$1 AND stage='pending'",[bot])).rows[0].n;
 if(pending>=20)return rejected('提醒和关心共用最多20条待办，请先取消不需要的。');
 const id=randomUUID();await db.query("INSERT INTO weixin_followups(id,bot_id,user_id,message,due_at,expires_at,kind,care_topic) VALUES($1,$2,$3,$4,$5,$6,'care',$7)",[id,bot,user,careMessage(topic),due,new Date(due.getTime()+CARE_WINDOW_MS),topic]);
 return {applied:true,reply:'已添加关心 '+reminderReference(id)+'：'+topic+'\n到约定时间尝试联系一次，30分钟内未能联系就过期，不补发、不连续催问。'};
}
