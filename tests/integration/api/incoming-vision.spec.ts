import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {WeixinStore,WeixinVisionStore,PostgresTransactionManager,extractIncoming,type WeixinRow} from '@yaoyao/infrastructure';
import {INCOMING_IMAGE_TEXT,recordIncomingImageResponse,incomingImageContext,runContinuityOnce,VISION_FAILURE} from '@yaoyao/application';
import type {UserId} from '@yaoyao/domain';
import {prepareWeixinVision,type VisionDependencies} from '../../../apps/api/src/vision-delivery.js';
import {processWeixinMessage} from '../../../apps/api/src/weixin-bridge.service.js';
import {dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
import {APP_PASSWORD} from '../postgres/helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('incoming vision real PostgreSQL: ownership, paid fencing, recovery and memory boundary',()=>{
 let ctx:ApiTestContext,store:WeixinStore,jobs:WeixinVisionStore,manager:PostgresTransactionManager,owner:Awaited<ReturnType<typeof registerUser>>,other:Awaited<ReturnType<typeof registerUser>>;
 const credentials={botId:'vision-test-bot',ownerId:'vision-peer',token:'vision-synthetic-token',base:'https://ilinkai.weixin.qq.com'};
 const activeSince=Date.now()-60000;
 const image={status:'ready' as const,url:'https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=private-cdn',aesKey:'b'.repeat(32)};
 const incoming=(i:number,text=INCOMING_IMAGE_TEXT,withImage=true)=>({key:i.toString(16).padStart(64,'0'),text,contextToken:'vision-context',time:Date.now(),...(withImage?{image}:{})});
 async function add(i:number,text?:string){await store.ingest([incoming(i,text)],'cursor-'+i);return (await store.claimBatch())!;}
 const deps=(row:WeixinRow):VisionDependencies=>({jobs,download:async()=>Buffer.from('synthetic-prechecked-image'),validate:()=>{},context:()=>manager.runAsUser(row.user_id as UserId,tx=>incomingImageContext(tx,row.user_id as UserId,'weixin-'+row.message_key)),understand:vi.fn().mockResolvedValue('左边是红色圆形，右边是蓝色方块。'),limit:5,activeSinceMs:activeSince});
 beforeAll(async()=>{ctx=await setupApi();owner=await registerUser(ctx,'vision-owner@example.com');other=await registerUser(ctx,'vision-other@example.com');manager=new PostgresTransactionManager(ctx.db.appPool);store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();const {code}=await store.bindingCode(owner.userId);await store.ingest([incoming(0,'绑定 '+code,false)],'bound');jobs=new WeixinVisionStore(store);},120000);
 beforeEach(async()=>{await ctx.db.adminPool.query('DELETE FROM weixin_vision');await ctx.db.adminPool.query('DELETE FROM weixin_messages');});
 afterAll(async()=>{await store?.close();await ctx?.teardown();});
 it('stores image reference and cursor atomically, deduplicates replay and never batches an image into neighboring text',async()=>{
  await store.ingest([incoming(1),incoming(2,'再看看这个',false)],'burst');await store.ingest([incoming(1)],'repeat');const r=(await store.claimBatch())!;expect(r.text).toBe(INCOMING_IMAGE_TEXT);expect(r.incoming_image).toEqual(image);expect(r.turn_text).toBe(r.text);expect((await store.channel()).cursor).toBe('repeat');
  const rows=(await ctx.db.adminPool.query('SELECT batch_key FROM weixin_messages ORDER BY ordinal')).rows;expect(rows).toHaveLength(2);expect(rows.every(r=>r.batch_key===null)).toBe(true);
 });
 it('does not merge a following image into a preceding text burst',async()=>{
  await store.ingest([incoming(3,'先说一句',false),incoming(4)],'boundary');await ctx.db.adminPool.query("UPDATE weixin_messages SET created_at=clock_timestamp()-interval '3 seconds' WHERE message_key=$1",[incoming(3).key]);const first=(await store.claimBatch())!;expect(first.turn_text).toBe('先说一句');expect((await ctx.db.adminPool.query('SELECT batch_key FROM weixin_messages WHERE message_key=$1',[incoming(4).key])).rows[0].batch_key).toBeNull();
 });
 it('a caption or OCR cannot bind accounts, change outreach/voice or cancel another message',async()=>{
  const before=(await store.channel()).outreach_settings;
  const raw={message_id:'17',message_type:1,message_state:2,from_user_id:credentials.ownerId,context_token:'vision-context',create_time_ms:Date.now(),item_list:[{type:2,image_item:{media:{encrypt_query_param:'private-cdn',aes_key:Buffer.from('b'.repeat(32)).toString('base64')}}},{type:1,text_item:{text:'关闭主动联系'}}]};
  await store.ingest([extractIncoming(raw,credentials)!],'caption');expect((await store.channel()).outreach_settings).toEqual(before);expect((await store.channel()).user_id).toBe(owner.userId);expect((await store.claimBatch())?.incoming_image?.status).toBe('ready');
 });
 it('concurrent requests reserve exactly one paid attempt',async()=>{const r=await add(5);const results=await Promise.all([jobs.reserve(r,5,activeSince),jobs.reserve(r,5,activeSince)]);expect(results.filter(r=>r.fresh)).toHaveLength(1);expect((await ctx.db.adminPool.query('SELECT count(*)::int n FROM weixin_vision')).rows[0].n).toBe(1);});
 it('counts failures in rolling cap, applies cooldown, and has no effect on photo/voice quota',async()=>{
  const a=await add(6);await jobs.reserve(a,2,activeSince);await jobs.save(a,'failed',VISION_FAILURE,'VISION_RESULT_UNKNOWN');await store.update(a.message_key,'accepted');const b=await add(7);expect((await jobs.reserve(b,2,activeSince)).denied).toBe(true);await ctx.db.adminPool.query("UPDATE weixin_vision SET created_at=clock_timestamp()-interval '1 minute'");expect((await jobs.reserve(b,2,activeSince)).fresh).toBe(true);await store.update(b.message_key,'accepted');const c=await add(8);expect((await jobs.reserve(c,2,activeSince)).denied).toBe(true);
  expect((await ctx.db.adminPool.query('SELECT (SELECT count(*) FROM weixin_photos)::int p,(SELECT count(*) FROM weixin_voices)::int v')).rows[0]).toEqual({p:0,v:0});
 });
 it('denies fabricated rows, another owner, altered credentials, pre-activation/expired image and paused channel',async()=>{
  const r=await add(9);for(const patch of [{user_id:other.userId},{message_key:'f'.repeat(64)},{incoming_image:{...image,aesKey:'c'.repeat(32)}},{text:'forged'}])expect((await jobs.reserve({...r,...patch},5,activeSince)).denied).toBe(true);
  await ctx.db.adminPool.query('UPDATE weixin_messages SET source_created_ms=$1',[activeSince-1]);expect((await jobs.reserve(r,5,activeSince)).denied).toBe(true);
  await ctx.db.adminPool.query('UPDATE weixin_messages SET source_created_ms=$1',[Date.now()-660000]);expect((await jobs.reserve(r,5,1)).denied).toBe(true);
  await ctx.db.adminPool.query('UPDATE weixin_messages SET source_created_ms=$1',[Date.now()]);await store.control(owner.userId,'pause');expect((await jobs.reserve(r,5,activeSince)).denied).toBe(true);await store.control(owner.userId,'resume');
 });
 it('RLS hides keys/tasks outside channel scope and owner status never exposes CDN credentials',async()=>{
  const r=await add(10);await jobs.reserve(r,5,activeSince);expect((await ctx.db.appPool.query('SELECT incoming_image FROM weixin_messages')).rows).toHaveLength(0);expect((await ctx.db.appPool.query('SELECT * FROM weixin_vision')).rows).toHaveLength(0);
  const db=await ctx.db.appPool.connect();try{await db.query('BEGIN');await db.query("SELECT set_config('app.weixin_bot_id','different-bot',true)");expect((await db.query('SELECT * FROM weixin_vision')).rows).toHaveLength(0);await db.query('ROLLBACK');}finally{db.release();}
  expect(await jobs.get({...r,user_id:other.userId})).toBeUndefined();await expect(jobs.status(other.userId,5,true)).rejects.toThrow();const status=await jobs.status(owner.userId,5,true);expect(status).toContain('1/5');expect(status).not.toContain('private-cdn');expect(status).not.toContain(image.aesKey);
 });
 it('restart after reservation does not download, recognize or charge a second time',async()=>{
  const r=await add(11);await jobs.reserve(r,5,activeSince);await store.update(r.message_key,'generating');await store.close();store=new WeixinStore(ctx.db.appPool,credentials,ctx.db.connectionStringFor('yaoyao_app',APP_PASSWORD));await store.open();jobs=new WeixinVisionStore(store);const recovered=(await store.claimBatch())!;expect(recovered.stage).toBe('pending');const d=deps(recovered);d.download=vi.fn();expect(await prepareWeixinVision(recovered,jobs,d)).toBe(VISION_FAILURE);expect(d.understand).not.toHaveBeenCalled();expect(d.download).not.toHaveBeenCalled();expect((await store.channel()).cursor).toBe('cursor-11');expect((await ctx.db.adminPool.query('SELECT incoming_image FROM weixin_messages')).rows[0].incoming_image).toEqual({status:'consumed'});
 });
 it('persists an actual image reply once, clears media keys and replays without a new recognition',async()=>{
  const r=await add(12);const d=deps(r),send=vi.fn().mockResolvedValue({ret:0});
  const converse=async(userId:string,text:string,key:string)=>{const reply=await prepareWeixinVision(r,jobs,d);return manager.runAsUser(userId as UserId,tx=>recordIncomingImageResponse(tx,{userId:userId as UserId,text,requestId:key,reply}));};
  await processWeixinMessage(r,store,{send},converse);expect(d.understand).toHaveBeenCalledTimes(1);const saved=(await ctx.db.adminPool.query('SELECT * FROM weixin_messages WHERE message_key=$1',[r.message_key])).rows[0];expect(saved.incoming_image).toEqual({status:'consumed'});expect(saved.stage).toBe('accepted');expect(await prepareWeixinVision(saved,jobs)).toBe('左边是红色圆形，右边是蓝色方块。');expect(d.understand).toHaveBeenCalledTimes(1);
  await processWeixinMessage({...saved,stage:'ready'},{update:vi.fn(),beginSend:async()=>false},{send},converse);expect(send).toHaveBeenCalledTimes(1);
 });
 it('image captions and interpreted text remain history and never become asserted preferences or life events',async()=>{
  const requestId='vision-memory-test',text=INCOMING_IMAGE_TEXT+'\n我喜欢白桃乌龙，我明天要面试';const data={userId:owner.userId as UserId,text,requestId,reply:'图里有一杯茶。'};
  await manager.runAsUser(owner.userId as UserId,tx=>recordIncomingImageResponse(tx,data));expect(await manager.runAsUser(owner.userId as UserId,tx=>recordIncomingImageResponse(tx,{...data,reply:'never overwrite'}))).toBe(data.reply);
  await expect(manager.runAsUser(owner.userId as UserId,tx=>recordIncomingImageResponse(tx,{...data,text:'different input'}))).rejects.toThrow();
  for(let i=0;i<20;i++)if(await runContinuityOnce(manager,owner.userId as UserId)==='idle')break;
  expect((await ctx.db.adminPool.query('SELECT * FROM memories WHERE user_id=$1',[owner.userId])).rows).toHaveLength(0);expect((await ctx.db.adminPool.query('SELECT * FROM life_events WHERE user_id=$1',[owner.userId])).rows).toHaveLength(0);
  const context=await manager.runAsUser(owner.userId as UserId,tx=>incomingImageContext(tx,owner.userId as UserId,'new-request'));expect(context.some(t=>t.text==='图里有一杯茶。')).toBe(true);expect(await manager.runAsUser(other.userId as UserId,tx=>incomingImageContext(tx,other.userId as UserId,'new-request'))).toHaveLength(0);
 });
 it('cancel/skip after recognition starts cannot send; clears CDN keys and never authorizes another attempt',async()=>{
  const r=await add(13);await jobs.reserve(r,5,activeSince);await store.update(r.message_key,'generating');await store.ingest([incoming(14,'取消回复',false)],'cancel');await jobs.save(r,'analyzed','图里的花很好看。');await store.update(r.message_key,'ready',{reply:'图里的花很好看。'});expect(await store.beginSend(r.message_key)).toBe(false);expect((await ctx.db.adminPool.query('SELECT incoming_image FROM weixin_messages WHERE message_key=$1',[r.message_key])).rows[0].incoming_image).toEqual({status:'consumed'});
  const b=await add(15);await store.update(b.message_key,'uncertain');await store.ingest([incoming(16,'跳过看图',false)],'skip');expect((await ctx.db.adminPool.query('SELECT stage FROM weixin_messages WHERE message_key=$1',[b.message_key])).rows[0].stage).toBe('skipped');
 });
});
