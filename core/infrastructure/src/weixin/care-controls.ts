import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {CARE_WINDOW_MS,careMessage,normalizeCareTopic,reminderReference,type OutreachSettings} from '@yaoyao/application';
export interface CarePayload {kind:'care';dueAt:string;topic:string;timezone:string}
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
