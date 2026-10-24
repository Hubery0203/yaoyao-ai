import {APP_PASSWORD} from "../postgres/helpers.js";
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {WeixinStore,type IncomingText} from '@yaoyao/infrastructure';
import {CONVERSATION_ORCHESTRATOR,ConversationOrchestrator} from '@yaoyao/runtime';
import type {UserId} from '@yaoyao/domain';
import {processWeixinMessage} from '../../../apps/api/src/weixin-bridge.service.js';
import {authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('W2/W3 real PostgreSQL and authenticated API',()=>{
 let ctx:ApiTestContext,store:WeixinStore,me:Awaited<ReturnType<typeof registerUser>>,other:Awaited<ReturnType<typeof registerUser>>;
 const c={botId:'integration-bot',ownerId:'scanner-only',token:'private-test',base:'https://ilinkai.weixin.qq.com'};
 const msg=(key:string,text='hello',time=Date.now()):IncomingText=>({key:key.padStart(64,'0'),text,time,contextToken:'private-context'});
 const bind=async()=>{const {code}=await store.bindingCode(me.userId);await store.ingest([msg('1','绑定 '+code)],'cursor-bound');};
 beforeAll(async()=>{
  ctx=await setupApi({status:id=>store.status(id),bindingCode:id=>store.bindingCode(id),control:(id,a)=>store.control(id,a),resolve:(id,k,a)=>store.resolve(id,k,a)});
  me=await registerUser(ctx,'weixin-owner@example.com');other=await registerUser(ctx,'weixin-other@example.com');
  store=new WeixinStore(ctx.db.appPool,c,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();
 },120000);
 afterAll(async()=>{await store?.close();await ctx?.teardown();});
 it('requires login for binding, status and controls',async()=>{
  expect((await ctx.http.get('/api/v1/weixin')).status).toBe(401);
  expect((await ctx.http.post('/api/v1/weixin/binding-code')).status).toBe(401);
  expect((await ctx.http.post('/api/v1/weixin/control').send({action:'pause'})).status).toBe(401);
 });
 it('holds a single receiver lock per bot',async()=>{const second=new WeixinStore(ctx.db.appPool,c,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await expect(second.open()).rejects.toThrow('CHANNEL_ALREADY_RUNNING');await second.close();});
 it('ignores pre-activation history and unbound ordinary text, preserving cursor',async()=>{
  const {code}=await store.bindingCode(me.userId);await store.ingest([msg('old','绑定 '+code,1),msg('unbound')],'cursor-initial');
  expect((await store.channel()).user_id).toBeNull();expect(await store.next()).toBeUndefined();expect((await store.channel()).cursor).toBe('cursor-initial');
 });
 it('hashes and expires codes, only authenticated account can generate',async()=>{
  const res=await ctx.http.post('/api/v1/weixin/binding-code').set(authHeader(me.accessToken));expect(res.status).toBe(200);expect(res.body.data.code).toMatch(/^[A-F0-9]{16}$/);
  const hashes=await ctx.db.adminPool.query('SELECT code_hash FROM weixin_binding_codes');expect(hashes.rows.some(r=>r.code_hash===res.body.data.code)).toBe(false);
  await ctx.db.adminPool.query("UPDATE weixin_binding_codes SET expires_at=clock_timestamp()-interval '1 second'");
  await store.ingest([msg('expired','绑定 '+res.body.data.code)],'cursor-expired');expect((await store.channel()).user_id).toBeNull();
 });
 it('consumes once, binds correct owner, denies takeover and hides other-owner delivery data',async()=>{
  await bind();expect((await store.channel()).user_id).toBe(me.userId);
  const status=await ctx.http.get('/api/v1/weixin').set(authHeader(other.accessToken));expect(status.body.data).toEqual({enabled:true,bound:false,available:false});
  expect((await ctx.http.post('/api/v1/weixin/binding-code').set(authHeader(other.accessToken))).status).toBe(409);
  expect((await ctx.http.post('/api/v1/weixin/control').set(authHeader(other.accessToken)).send({action:'pause'})).status).toBe(409);
  await store.update(msg('1').key,'accepted');
 });
 it('atomically deduplicates batch and cursor',async()=>{
  await store.ingest([msg('2'),msg('2')],'cursor-two');
  const r=await ctx.db.adminPool.query('SELECT count(*)::int n FROM weixin_messages WHERE message_key=$1',[msg('2').key]);expect(r.rows[0].n).toBe(1);expect((await store.channel()).cursor).toBe('cursor-two');
 });
 it('uses same Core owner and request key; webhook retry never duplicates web history',async()=>{
  const row=(await store.next())!;const core=ctx.app.get<ConversationOrchestrator>(CONVERSATION_ORCHESTRATOR);
  const converse=async(id:string,text:string,key:string)=>(await core.converse({userId:id as UserId,text,traceId:key,requestId:key})).response;
  await processWeixinMessage(row,store,{send:async()=>({})},converse);
  await converse(row.user_id,row.text,'weixin-'+row.message_key);
  const history=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(me.accessToken));expect(history.body.data.messages).toHaveLength(2);expect(history.body.data.messages[0].requestId).toBe('weixin-'+row.message_key);
  expect((await ctx.http.get('/api/v1/conversations/messages').set(authHeader(other.accessToken))).body.data.messages).toHaveLength(0);
 });
 it('owner pause persists and validation rejects arbitrary controls',async()=>{
  expect((await ctx.http.post('/api/v1/weixin/control').set(authHeader(me.accessToken)).send({action:'pause'})).status).toBe(200);expect((await store.channel()).paused).toBe(true);
  expect((await ctx.http.post('/api/v1/weixin/control').set(authHeader(me.accessToken)).send({action:'anything'})).status).toBe(400);
  await store.control(me.userId,'resume');
 });
 it('rolls back batch and cursor if durable inbox is full',async()=>{
  const before=(await store.channel()).cursor;
  await expect(store.ingest(Array.from({length:101},(_,i)=>msg(String(i+100))),'must-not-commit')).rejects.toThrow('BACKLOG_FULL');
  expect((await store.channel()).cursor).toBe(before);expect(await store.next()).toBeUndefined();
 });
 it('restart converts in-flight send to uncertain and preserves cursor and queued generation',async()=>{
  await store.ingest([msg('3'),msg('4')],'cursor-restart');await store.update(msg('3').key,'sending',{reply:'saved reply'});await store.update(msg('4').key,'generating');
  await store.close();store=new WeixinStore(ctx.db.appPool,c,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();
  expect((await store.next())?.stage).toBe('uncertain');expect((await store.channel()).cursor).toBe('cursor-restart');
  const r=await ctx.db.adminPool.query('SELECT stage FROM weixin_messages WHERE message_key=$1',[msg('4').key]);expect(r.rows[0].stage).toBe('pending');
 });
 it('only owner explicitly resolves uncertain send; retry reuses saved reply',async()=>{
  const path='/api/v1/weixin/deliveries/'+msg('3').key+'/resolve';
  expect((await ctx.http.post(path).set(authHeader(other.accessToken)).send({action:'retry'})).status).toBe(409);
  expect((await ctx.http.post(path).set(authHeader(me.accessToken)).send({action:'retry'})).status).toBe(200);
  expect((await store.next())?.stage).toBe('ready');expect((await store.next())?.reply).toBe('saved reply');
  await store.update(msg('3').key,'uncertain');await store.resolve(me.userId,msg('3').key,'confirm');expect((await store.next())?.message_key).toBe(msg('4').key);
 });
 it('RLS denies unscoped app queries and other bot context',async()=>{
  expect((await ctx.db.appPool.query('SELECT * FROM weixin_channels')).rows).toHaveLength(0);
  const db=await ctx.db.appPool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.weixin_bot_id','other-bot',true)");expect((await db.query('SELECT * FROM weixin_messages')).rows).toHaveLength(0);await db.query('ROLLBACK');}finally{db.release();}
 });
 it('auth stays paused across same-token restart; token rotation clears auth pause without rebinding',async()=>{
  await store.error('AUTH_EXPIRED',true);await store.close();store=new WeixinStore(ctx.db.appPool,c,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();expect((await store.channel()).auth_expired).toBe(true);
  await store.close();store=new WeixinStore(ctx.db.appPool,{...c,token:'rotated-private-test'},ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();expect((await store.channel()).auth_expired).toBe(false);expect((await store.channel()).user_id).toBe(me.userId);
 });
});
