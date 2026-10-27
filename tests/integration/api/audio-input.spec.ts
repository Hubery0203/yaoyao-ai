import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {WeixinStore,WeixinAudioStore,WeixinVoiceStore,PostgresTransactionManager,type WeixinCredentials} from '@yaoyao/infrastructure';
import {INCOMING_AUDIO_TEXT,AUDIO_CONTROL_CONFIRM,recordIncomingAudioResponse,runContinuityOnce} from '@yaoyao/application';
import {CONVERSATION_ORCHESTRATOR,type ConversationOrchestrator} from '@yaoyao/runtime';
import type {UserId} from '@yaoyao/domain';
import {WeixinBridgeService,processWeixinMessage} from '../../../apps/api/src/weixin-bridge.service.js';
import {recognizeIncomingAudio,type AudioInputDependencies} from '../../../apps/api/src/audio-input.js';
import {prepareWeixinVoice,type VoiceDependencies} from '../../../apps/api/src/voice-delivery.js';
import {dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
import {APP_PASSWORD} from '../postgres/helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('voice input real PG: native/paid attempts, Core provenance, replay and output voice',()=>{
 let ctx:ApiTestContext,store:WeixinStore,jobs:WeixinAudioStore,manager:PostgresTransactionManager,owner:Awaited<ReturnType<typeof registerUser>>,other:Awaited<ReturnType<typeof registerUser>>,core:ConversationOrchestrator;
 const credentials={botId:'audio-test-bot',ownerId:'audio-peer',token:'synthetic-token',base:'https://ilinkai.weixin.qq.com'},since=Date.now()-60000;
 const audio={status:'ready' as const,codec:'silk' as const,durationMs:1000,url:'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=private-audio',aesKey:'c'.repeat(32)};
 const incoming=(i:number,text=INCOMING_AUDIO_TEXT,kind:'audio'|'text'='audio')=>({key:i.toString(16).padStart(64,'0'),text,contextToken:'synthetic-context',time:Date.now(),...(kind==='audio'?{audio}:{})});
 async function add(i:number,nativeText?:string){const m=incoming(i);await store.ingest([{...m,...(nativeText?{audio:{status:'native' as const,nativeText,durationMs:1000}}:{})}],'cursor-'+i);return (await store.claimBatch())!;}
 const deps=():AudioInputDependencies=>({jobs,prepare:vi.fn().mockResolvedValue(Buffer.from('prevalidated-audio')),validate:()=>{},transcribe:vi.fn().mockResolvedValue({text:'今天下雨了',durationMs:1000}),limit:10,activeSinceMs:since});
 beforeAll(async()=>{ctx=await setupApi();owner=await registerUser(ctx,'audio-owner@example.com');other=await registerUser(ctx,'audio-other@example.com');manager=new PostgresTransactionManager(ctx.db.appPool);core=ctx.app.get(CONVERSATION_ORCHESTRATOR);store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();const {code}=await store.bindingCode(owner.userId);await store.ingest([incoming(0,'绑定 '+code,'text')],'bound');jobs=new WeixinAudioStore(store);},120000);
 beforeEach(async()=>{await ctx.db.adminPool.query('DELETE FROM weixin_audio');await ctx.db.adminPool.query('DELETE FROM weixin_voices');await ctx.db.adminPool.query('DELETE FROM weixin_messages');});
 afterAll(async()=>{await store?.close();await ctx?.teardown();});
 async function deliverOne(){
  const values={ASR_ENABLED:'1',MINIMAX_ASR_API_KEY:'synthetic-asr-key',MINIMAX_ASR_REGION:'cn',ASR_ACTIVE_SINCE:new Date(since).toISOString(),VOICE_ENABLED:'0'};const before=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
  const converse=vi.fn((input:Parameters<ConversationOrchestrator['converse']>[0])=>core.converse(input));let bridge:WeixinBridgeService;
  try{bridge=new WeixinBridgeService(ctx.db.appPool,{converse} as never,{acquire:()=>true,release:()=>{},registerOwner:()=>{}} as never,manager);}finally{for(const[k,v]of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;}
  const internal=bridge! as unknown as {stopped:boolean;deliveryLoop(store:WeixinStore,client:never):Promise<void>};const send=vi.fn(async()=>{internal.stopped=true;return{ret:0};});const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('Unexpected network call in native-input integration'));const timer=setTimeout(()=>{internal.stopped=true;},4000);
  try{await internal.deliveryLoop(store,{send,credentials:credentials as WeixinCredentials} as never);}finally{clearTimeout(timer);fetcher.mockRestore();}
  expect(send).toHaveBeenCalledOnce();return {send,converse};
 }
 it('keeps voice standalone, persists cursor with one immutable message and deduplicates poll replay',async()=>{
  await store.ingest([incoming(1),incoming(2,'我回来了','text')],'burst');await store.ingest([incoming(1)],'repeat');const r=(await store.claimBatch())!;expect(r.incoming_audio).toEqual(audio);expect(r.turn_text).toBe(INCOMING_AUDIO_TEXT);expect((await ctx.db.adminPool.query('SELECT batch_key FROM weixin_messages')).rows.every(r=>r.batch_key===null)).toBe(true);expect((await ctx.db.adminPool.query('SELECT count(*)::int n FROM weixin_messages')).rows[0].n).toBe(2);expect((await store.channel()).cursor).toBe('repeat');
 });
 it('authorizes only one paid attempt under concurrent reservations and includes failure in rolling cap',async()=>{
  const r=await add(3),all=await Promise.all([jobs.reserve(r,1,since,'minimax'),jobs.reserve(r,1,since,'minimax')]);expect(all.filter(x=>x.fresh)).toHaveLength(1);await jobs.save(r,'failed',null,'ASR_RESULT_UNKNOWN');await store.update(r.message_key,'accepted');const next=await add(4);expect((await jobs.reserve(next,1,since,'minimax')).denied).toBe(true);
 });
 it('stores native text without paid attempt, download or provider and allows it after paid quota is exhausted',async()=>{
  const r=await add(5);await jobs.reserve(r,1,since,'minimax');await jobs.save(r,'failed',null,'ASR_AUTH');await store.update(r.message_key,'accepted');const next=await add(6,'今天下雨了'),d=deps();d.limit=1;expect(await recognizeIncomingAudio(next,jobs,d)).toEqual({ok:true,text:'今天下雨了',source:'weixin'});expect(d.prepare).not.toHaveBeenCalled();expect(d.transcribe).not.toHaveBeenCalled();expect((await ctx.db.adminPool.query("SELECT count(*)::int n FROM weixin_audio WHERE attempted_at IS NOT NULL")).rows[0].n).toBe(1);expect((await ctx.db.adminPool.query('SELECT incoming_audio FROM weixin_messages WHERE message_key=$1',[next.message_key])).rows[0].incoming_audio).toEqual({status:'consumed'});
 });
 it('rejects another owner, fabricated/altered payload, paused/cancelled or pre-activation sources',async()=>{
  const r=await add(7);for(const patch of [{user_id:other.userId},{message_key:'f'.repeat(64)},{incoming_audio:{...audio,aesKey:'d'.repeat(32)}}])expect((await jobs.reserve({...r,...patch},10,since,'minimax')).denied).toBe(true);
  await store.control(owner.userId,'pause');expect((await jobs.reserve(r,10,since,'minimax')).denied).toBe(true);await store.control(owner.userId,'resume');await ctx.db.adminPool.query('UPDATE weixin_messages SET source_created_ms=$1',[since-1]);expect((await jobs.reserve(r,10,since,'minimax')).denied).toBe(true);await ctx.db.adminPool.query('UPDATE weixin_messages SET source_created_ms=$1',[Date.now()]);await store.update(r.message_key,'skipped');expect((await jobs.reserve(r,10,since,'minimax')).denied).toBe(true);
 });
 it('RLS hides media/transcripts/tasks from unscoped or another channel; status does not expose them',async()=>{
  const r=await add(8);await jobs.reserve(r,10,since,'minimax');expect((await ctx.db.appPool.query('SELECT * FROM weixin_audio')).rows).toHaveLength(0);expect((await ctx.db.appPool.query('SELECT incoming_audio FROM weixin_messages')).rows).toHaveLength(0);const db=await ctx.db.appPool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.weixin_bot_id','other-bot',true)");expect((await db.query('SELECT * FROM weixin_audio')).rows).toHaveLength(0);await db.query('ROLLBACK');}finally{db.release();}
  expect(await jobs.get({...r,user_id:other.userId})).toBeUndefined();await expect(jobs.status(other.userId,10,true)).rejects.toThrow();const status=await jobs.status(owner.userId,10,true);expect(status).toContain('1/10');expect(status).not.toContain('private-audio');expect(status).not.toContain(audio.aesKey);
 });
 it('an abandoned recognition reservation survives receiver restart and cannot make another paid call',async()=>{
  const r=await add(9);await jobs.reserve(r,10,since,'minimax');await store.update(r.message_key,'generating');await store.close();store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();jobs=new WeixinAudioStore(store);const recovered=(await store.claimBatch())!,d=deps();expect(await recognizeIncomingAudio(recovered,jobs,d)).toMatchObject({ok:false});expect(d.prepare).not.toHaveBeenCalled();expect(d.transcribe).not.toHaveBeenCalled();expect((await jobs.get(recovered))?.state).toBe('failed');expect((await store.channel()).cursor).toBe('cursor-9');
 });
 it('reuses successful transcription after receiver restart without configuration or a second call',async()=>{
  const r=await add(10);await jobs.reserve(r,10,since,'minimax');await jobs.save(r,'transcribed','我下班啦');await store.close();store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();jobs=new WeixinAudioStore(store);expect(await recognizeIncomingAudio((await store.claimBatch())!,jobs)).toEqual({ok:true,text:'我下班啦',source:'minimax'});
 });
 it('the actual bridge passes recognized text to the same Core with voice provenance and persists one history pair',async()=>{
  const r=await add(11,'我喜欢白桃乌龙');const {converse}=await deliverOne();expect(converse).toHaveBeenCalledOnce();expect(converse.mock.calls[0][0]).toMatchObject({text:'我喜欢白桃乌龙',attachment:'voice',requestId:'weixin-'+r.message_key});
  const events=(await ctx.db.adminPool.query('SELECT type,payload FROM events WHERE correlation_id=$1',['weixin-'+r.message_key])).rows;expect(events.filter(e=>e.type==='USER_MESSAGE')).toHaveLength(1);expect(events.find(e=>e.type==='USER_MESSAGE').payload.attachment).toBe('voice');expect(events.filter(e=>e.type==='ASSISTANT_MESSAGE')).toHaveLength(1);
  for(let i=0;i<20;i++)if(await runContinuityOnce(manager,owner.userId as UserId)==='idle')break;
  expect((await ctx.db.adminPool.query('SELECT * FROM memories WHERE user_id=$1',[owner.userId])).rows).toHaveLength(0);expect((await ctx.db.adminPool.query('SELECT * FROM life_events WHERE user_id=$1',[owner.userId])).rows).toHaveLength(0);
 });
 it('the actual bridge requires typed controls without running Core or changing voice/outreach settings',async()=>{
  const r=await add(12,'关闭主动联系');const before=JSON.stringify((await store.channel()).outreach_settings),{converse,send}=await deliverOne();expect(converse).not.toHaveBeenCalled();expect(send.mock.calls[0][2]).toBe(AUDIO_CONTROL_CONFIRM);expect(JSON.stringify((await store.channel()).outreach_settings)).toBe(before);expect((await ctx.db.adminPool.query('SELECT reply FROM weixin_messages WHERE message_key=$1',[r.message_key])).rows[0].reply).toBe(AUDIO_CONTROL_CONFIRM);
 });
 it('recovers recognition and already-completed Core history after a crash before the queue reply commit',async()=>{
  const r=await add(13,'我刚刚下班');await recognizeIncomingAudio(r,jobs,deps());await store.update(r.message_key,'generating');const completed=await core.converse({userId:owner.userId,text:'我刚刚下班',attachment:'voice',requestId:'weixin-'+r.message_key,traceId:'audio-crash'});await store.close();store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();jobs=new WeixinAudioStore(store);const {converse,send}=await deliverOne();expect(send.mock.calls[0][2]).toBe(completed.response);const replay=await converse.mock.results[0].value;expect((replay.trace as unknown as {eventCreation:{status:string}}).eventCreation.status).toBe('idempotent-replay');expect((await ctx.db.adminPool.query('SELECT * FROM events WHERE correlation_id=$1',['weixin-'+r.message_key])).rows).toHaveLength(2);
 });
 it('cancel/skip during recognition prevents delivery and clears references without resetting paid quota',async()=>{
  const r=await add(14);await jobs.reserve(r,10,since,'minimax');await store.update(r.message_key,'generating');await store.ingest([incoming(15,'取消回复','text')],'cancel');await jobs.save(r,'transcribed','我回来了');await store.update(r.message_key,'ready',{reply:'我在呢'});expect(await store.beginSend(r.message_key)).toBe(false);expect((await ctx.db.adminPool.query('SELECT incoming_audio FROM weixin_messages WHERE message_key=$1',[r.message_key])).rows[0].incoming_audio).toEqual({status:'consumed'});
  const next=await add(16);await store.update(next.message_key,'uncertain');await store.ingest([incoming(17,'跳过识别','text')],'skip');expect((await ctx.db.adminPool.query('SELECT stage FROM weixin_messages WHERE message_key=$1',[next.message_key])).rows[0].stage).toBe('skipped');expect((await ctx.db.adminPool.query("SELECT count(*)::int n FROM weixin_audio WHERE attempted_at IS NOT NULL")).rows[0].n).toBe(1);
 });
 it('renders an audio-input Core reply through the unchanged selected voice and synthesis quota',async()=>{
  const r=await add(18,'我回来啦');await ctx.db.adminPool.query("INSERT INTO weixin_voice_settings(bot_id,user_id,enabled,enabled_at,voice) VALUES($1,$2,true,clock_timestamp()-interval '1 minute','wumei') ON CONFLICT(bot_id) DO UPDATE SET enabled=true,enabled_at=clock_timestamp()-interval '1 minute',voice='wumei'",[credentials.botId,owner.userId]);
  const voice=new WeixinVoiceStore(store,0),reply='回来啦，抱一下～',media={encryptQueryParam:'synthetic-upload',aesKey:'a'.repeat(32),ciphertextSize:32,plaintextSize:20};
  const generate=vi.fn().mockResolvedValue(Buffer.from('synthetic-mp3')),vd:VoiceDependencies={jobs:voice,files:{available:async()=>{},save:async()=> 'a'.repeat(64),read:async()=>Buffer.from('synthetic-mp3')},generate,upload:async()=>media,limit:10};let sentAudio=false;
  await processWeixinMessage(r,store,{send:async()=>{sentAudio=!!await voice.sendingMedia(r,reply);return{ret:0};}},async(uid,_text,key)=>{const recognized=await recognizeIncomingAudio(r,jobs,deps());if(!recognized.ok)throw Error('Expected native input');const text=await manager.runAsUser(uid as UserId,tx=>recordIncomingAudioResponse(tx,{userId:uid as UserId,text:recognized.text,requestId:key,reply}));await voice.register(r,text);return text;},text=>prepareWeixinVoice(r,text,vd));expect(sentAudio).toBe(true);expect(generate).toHaveBeenCalledWith(reply,'wumei');expect((await ctx.db.adminPool.query("SELECT count(*)::int n FROM weixin_voices WHERE attempted_at IS NOT NULL")).rows[0].n).toBe(1);expect((await ctx.db.adminPool.query("SELECT count(*)::int n FROM weixin_audio WHERE attempted_at IS NOT NULL")).rows[0].n).toBe(0);
 });
});
