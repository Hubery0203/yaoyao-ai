import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {DEFAULT_OUTREACH,localOutreachClock,recordAcceptedOutreach,type OutreachSettings,type WeixinExperiencePort} from '@yaoyao/application';
import {WeixinStore,PostgresTransactionManager,type IncomingText} from '@yaoyao/infrastructure';
import {CONVERSATION_ORCHESTRATOR,ConversationOrchestrator} from '@yaoyao/runtime';
import type {UserId} from '@yaoyao/domain';
import {processWeixinMessage} from '../../../apps/api/src/weixin-bridge.service.js';
import {APP_PASSWORD} from '../postgres/helpers.js';
import {authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('007 real inbox, outreach and owner isolation',()=>{
 let ctx:ApiTestContext,store:WeixinStore,owner:Awaited<ReturnType<typeof registerUser>>,other:Awaited<ReturnType<typeof registerUser>>;
 const credentials={botId:'experience-007',ownerId:'owner',base:'https://ilinkai.weixin.qq.com',token:'test-private'};
 const msg=(key:string,text:string):IncomingText=>({key:key.padStart(64,'0'),text,contextToken:'secret-context-'+key,time:Date.now()});
 const all=async()=> (await ctx.db.adminPool.query('SELECT * FROM weixin_messages ORDER BY ordinal')).rows;
 const settings=():OutreachSettings=>{const minute=localOutreachClock(new Date(),'UTC').minute;return {...DEFAULT_OUTREACH,enabled:true,timezone:'UTC',greetingMinute:minute,quietStart:(minute+120)%1440,quietEnd:(minute+180)%1440};};
 const activity=async(age=1200000)=>ctx.db.adminPool.query('UPDATE weixin_channels SET last_inbound_at=$1,last_context_token=$2',[new Date(Date.now()-age),'private-proactive-context']);
 const due=()=>new Date(Date.now()+1000).toISOString();
 beforeAll(async()=>{
  const port:WeixinExperiencePort={status:id=>store.status(id),bindingCode:id=>store.bindingCode(id),control:(id,a)=>store.control(id,a),resolve:(id,k,a)=>store.resolve(id,k,a),settings:(id,s)=>store.settings(id,s),followup:(id,m,d)=>store.followup(id,m,d),cancelFollowup:(id,k)=>store.cancelFollowup(id,k)};
  ctx=await setupApi(port);owner=await registerUser(ctx,'007-owner@example.com');other=await registerUser(ctx,'007-other@example.com');
  store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();
  const {code}=await store.bindingCode(owner.userId);await store.ingest([msg('bind','绑定 '+code)],'bound');await store.update(msg('bind','').key,'accepted');
 },120000);
 beforeEach(async()=>{
  await ctx.db.adminPool.query('DELETE FROM weixin_followups');await ctx.db.adminPool.query('DELETE FROM weixin_messages');
  await ctx.db.adminPool.query('UPDATE weixin_channels SET outreach_settings=$1,outreach_version=0,outreach_since=NULL,paused=false,auth_expired=false,last_inbound_at=NULL,last_context_token=NULL',[DEFAULT_OUTREACH]);
 });
 afterAll(async()=>{await store?.close();await ctx?.teardown();});
 it('requires auth and ownership for all new controls',async()=>{
  expect((await ctx.http.post('/api/v1/weixin/outreach').send(settings())).status).toBe(401);
  expect((await ctx.http.post('/api/v1/weixin/outreach').set(authHeader(other.accessToken)).send(settings())).status).toBe(409);
  expect((await ctx.http.post('/api/v1/weixin/followups').set(authHeader(other.accessToken)).send({message:'hello',dueAt:due()})).status).toBe(409);
  expect((await ctx.http.get('/api/v1/weixin').set(authHeader(other.accessToken))).body.data.outreach).toBeUndefined();
 });
 it('rejects malformed settings and followup bodies',async()=>{
  for(const body of [{...settings(),timezone:'bad/zone'},{...settings(),dailyLimit:50},{...settings(),quietStart:1,quietEnd:1},{...settings(),unknown:true}])expect((await ctx.http.post('/api/v1/weixin/outreach').set(authHeader(owner.accessToken)).send(body)).status).toBe(400);
  expect((await ctx.http.post('/api/v1/weixin/followups').set(authHeader(owner.accessToken)).send({message:'',dueAt:due()})).status).toBe(400);
 });
 it('defaults disabled and never synthesizes a reason from memories',async()=>{await activity();await store.scheduleOutreach();expect(await all()).toHaveLength(0);await expect(store.followup(owner.userId,'hello',due())).rejects.toThrow('OUTREACH_DISABLED');});
 it('waits for a burst, then seals ordered raw messages into one immutable turn',async()=>{
  await store.ingest([msg('1','我今天终于下班了'),msg('2','累死了')],'burst');expect(await store.claimBatch()).toBeUndefined();
  const batch=(await store.claimBatch(new Date(Date.now()+2000)))!;expect(batch.turn_text).toBe('我今天终于下班了\n累死了');
  expect((await all())[1].batch_key).toBe(batch.message_key);
  await store.ingest([msg('3','先吃点东西')],'later');expect((await store.claimBatch())?.turn_text).toBe(batch.turn_text);
  await store.update(batch.message_key,'accepted');expect((await all()).slice(0,2).every(r=>r.stage==='accepted')).toBe(true);expect((await store.next())?.message_key).toBe(msg('3','').key);
 });
 it('never merges across a ready binding reply or a 4000-character limit',async()=>{
  await store.ingest([msg('1','x'.repeat(3000)),msg('2','y'.repeat(2000))],'limit');const batch=(await store.claimBatch(new Date(Date.now()+2000)))!;expect(batch.turn_text).toHaveLength(3000);expect((await all())[1].batch_key).toBeNull();
 });
 it('replays the same Core batch key and text without duplicating history',async()=>{
  await store.ingest([msg('c1','今天下班了'),msg('c2','晚饭吃面')],'core');const row=(await store.claimBatch(new Date(Date.now()+2000)))!;
  const core=ctx.app.get<ConversationOrchestrator>(CONVERSATION_ORCHESTRATOR),converse=async(id:string,text:string,key:string)=>(await core.converse({userId:id,text,traceId:key,requestId:key})).response;
  await processWeixinMessage(row,store,{send:async()=>({ret:0})},converse);await converse(owner.userId,row.turn_text!,'weixin-'+row.message_key);
  const h=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(owner.accessToken));expect(h.body.data.messages.filter((m:{requestId:string})=>m.requestId==='weixin-'+row.message_key)).toHaveLength(2);
 });
 it('cancel command fences a generated late reply without resurrecting skipped rows',async()=>{
  await store.ingest([msg('1','先聊这个')],'first');const row=(await store.claimBatch(new Date(Date.now()+2000)))!;await store.update(row.message_key,'generating');
  await store.ingest([msg('cancel','取消回复')],'cancel');await store.update(row.message_key,'ready',{reply:'too late'});expect(await store.beginSend(row.message_key)).toBe(false);expect(await store.next()).toBeUndefined();
 });
 it('pause wins before the send boundary; resume retains the sealed batch',async()=>{
  await store.ingest([msg('1','hello')],'pause');const row=(await store.claimBatch(new Date(Date.now()+2000)))!;await store.update(row.message_key,'ready',{reply:'reply'});await store.control(owner.userId,'pause');expect(await store.beginSend(row.message_key)).toBe(false);await store.control(owner.userId,'resume');expect(await store.beginSend(row.message_key)).toBe(true);
 });
 it('restart retains groups and recovers sending as uncertain without replaying a child',async()=>{
  await store.ingest([msg('1','first'),msg('2','second')],'restart');const row=(await store.claimBatch(new Date(Date.now()+2000)))!;await store.update(row.message_key,'ready',{reply:'saved'});await store.beginSend(row.message_key);
  await store.close();await store.open();expect((await store.next())?.stage).toBe('uncertain');await store.resolve(owner.userId,row.message_key,'confirm');expect(await store.next()).toBeUndefined();expect((await all()).every(r=>r.stage==='confirmed')).toBe(true);
 });
 it('deduplicates polling while the same reply is generating',async()=>{
  await store.ingest([msg('1','first')],'a');const row=(await store.claimBatch(new Date(Date.now()+2000)))!;await store.update(row.message_key,'generating');await store.ingest([msg('1','first'),msg('2','new')],'b');expect(await all()).toHaveLength(2);expect((await store.channel()).cursor).toBe('b');expect((await store.claimBatch())?.turn_text).toBe('first');
 });
 it('schedules only an explicitly configured followup and records accepted history once',async()=>{
  await store.settings(owner.userId,settings());await activity();const job=await store.followup(owner.userId,'面试怎么样呀？',due());await store.scheduleOutreach(new Date(Date.now()+2000));
  const row=(await store.next())!;expect(row.reply).toBe('面试怎么样呀？');expect(row.origin).toBe('proactive');const generate=vi.fn();await processWeixinMessage(row,store,{send:async()=>({ret:0})},generate);expect(generate).not.toHaveBeenCalled();
  const history=(await store.nextOutreachHistory())!,tx=new PostgresTransactionManager(ctx.db.appPool);const record=()=>tx.runAsUser(owner.userId as UserId,t=>recordAcceptedOutreach(t,{userId:owner.userId as UserId,key:history.message_key,text:history.reply!}));await record();await record();await store.outreachHistoryRecorded(history.message_key);expect(await store.nextOutreachHistory()).toBeUndefined();
  const events=(await ctx.db.adminPool.query("SELECT type,payload FROM events WHERE correlation_id=$1",['weixin-outreach-'+row.message_key])).rows;expect(events).toHaveLength(1);expect(events[0].type).toBe('ASSISTANT_MESSAGE');expect(events[0].payload.text).toBe('面试怎么样呀？');
  expect((await ctx.db.adminPool.query('SELECT 1 FROM continuity_jobs WHERE request_id=$1',['weixin-outreach-'+row.message_key])).rowCount).toBe(0);
  expect(job.id).toMatch(/^[a-f0-9-]{36}$/);
 });
 it('owner can inspect and cancel own followup without leaking context tokens',async()=>{
  await store.settings(owner.userId,settings());const {id}=await store.followup(owner.userId,'面试怎么样？',due());
  expect((await ctx.http.post('/api/v1/weixin/followups/'+id+'/cancel').set(authHeader(other.accessToken)).send({})).status).toBe(409);
  const status=await ctx.http.get('/api/v1/weixin').set(authHeader(owner.accessToken));expect(status.body.data.followups[0].id).toBe(id);expect(JSON.stringify(status.body)).not.toContain('private-proactive-context');
  expect((await ctx.http.post('/api/v1/weixin/followups/'+id+'/cancel').set(authHeader(owner.accessToken)).send({})).status).toBe(200);
 });
 it('disabled, quiet, paused, stale-context and active-chat states never reserve outreach',async()=>{
  const s=settings();await store.settings(owner.userId,{...s,greeting:true});await activity(25*3600000);await store.scheduleOutreach();expect(await all()).toHaveLength(0);
  await activity(1000);await store.scheduleOutreach();expect(await all()).toHaveLength(0);
  await activity();await store.control(owner.userId,'pause');await store.scheduleOutreach();expect(await all()).toHaveLength(0);
  await store.control(owner.userId,'resume');const m=localOutreachClock(new Date(),'UTC').minute;await store.settings(owner.userId,{...s,greeting:true,quietStart:m,quietEnd:(m+1)%1440});await store.scheduleOutreach();expect(await all()).toHaveLength(0);
 });
 it('daily and rolling limits survive repeated scheduler calls and restarts',async()=>{
  await store.settings(owner.userId,{...settings(),greeting:true});await activity();await Promise.all([store.scheduleOutreach(),store.scheduleOutreach()]);expect(await all()).toHaveLength(1);const row=(await store.next())!;await store.update(row.message_key,'accepted');await store.close();await store.open();await store.scheduleOutreach();expect(await all()).toHaveLength(1);
 });
 it('new user activity and disable each invalidate unsent outreach',async()=>{
  await store.settings(owner.userId,{...settings(),greeting:true});await activity();await store.scheduleOutreach();const row=(await store.next())!;await store.ingest([msg('user','hello')],'active');expect(await store.beginSend(row.message_key)).toBe(false);
  await store.settings(owner.userId,{...settings(),enabled:false});expect((await store.channel()).outreach_settings.enabled).toBe(false);
 });
 it('chat stop command persists opt-out and skips pending outbound',async()=>{
  await store.settings(owner.userId,{...settings(),greeting:true});await activity();await store.scheduleOutreach();await store.ingest([msg('stop','关闭主动联系')],'stop');expect((await store.channel()).outreach_settings.enabled).toBe(false);expect(await store.next()).toBeUndefined();
 });
 it('bounds and expires explicit tasks without catching up disabled-period tasks',async()=>{
  await store.settings(owner.userId,settings());await expect(store.followup(owner.userId,'hello',new Date(Date.now()-1).toISOString())).rejects.toThrow('INVALID_FOLLOWUP');await expect(store.followup(owner.userId,'hello',new Date(Date.now()+31*86400000).toISOString())).rejects.toThrow('INVALID_FOLLOWUP');
  await store.followup(owner.userId,'hello',due());await activity();await store.scheduleOutreach(new Date(Date.now()+2*86400000));expect(await all()).toHaveLength(0);expect((await ctx.db.adminPool.query('SELECT stage FROM weixin_followups')).rows[0].stage).toBe('expired');
 });
 it('does not report cancellation after a followup already entered sending',async()=>{
  await store.settings(owner.userId,settings());await activity();const job=await store.followup(owner.userId,'面试怎么样？',due());await store.scheduleOutreach(new Date(Date.now()+2000));const row=(await store.next())!;expect(await store.beginSend(row.message_key)).toBe(true);
  await expect(store.cancelFollowup(owner.userId,job.id)).rejects.toThrow('FOLLOWUP_ALREADY_SENDING');expect((await all())[0].stage).toBe('sending');
 });
 it('rechecks opt-out and configuration version at the final outbound boundary',async()=>{
  await store.settings(owner.userId,{...settings(),greeting:true});await activity();await store.scheduleOutreach();const row=(await store.next())!;
  await store.settings(owner.userId,{...settings(),enabled:false});expect(await store.beginSend(row.message_key)).toBe(false);expect((await all())[0].stage).toBe('skipped');
 });
 it('forced RLS hides followups from unscoped and other-bot app queries',async()=>{
  await store.settings(owner.userId,settings());await store.followup(owner.userId,'hello',due());expect((await ctx.db.appPool.query('SELECT * FROM weixin_followups')).rows).toHaveLength(0);
  await store.tx(async db=>{await db.query("SELECT set_config('app.weixin_bot_id','other-bot',true)");expect((await db.query('SELECT * FROM weixin_followups')).rows).toHaveLength(0);});
 });
});
