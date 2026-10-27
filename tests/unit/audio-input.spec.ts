import {describe,it,expect,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {createCipheriv} from 'node:crypto';
import {resolve} from 'node:path';
import {extractIncoming,parseIncomingAudio,prepareIncomingWav,pcmToWav,inspectAsrWav,inspectSilk,MiniMaxAsrProvider,AsrError,loadConfig,type WeixinRow} from '@yaoyao/infrastructure';
import {audioNeedsTypedConfirmation,INCOMING_AUDIO_TEXT,AUDIO_UNCLEAR,AUDIO_DISABLED,AUDIO_LIMIT,AUDIO_UNSUPPORTED} from '@yaoyao/application';
import {recognizeIncomingAudio,audioInputConfigured,type AudioInputDependencies} from '../../apps/api/src/audio-input.js';
const c={base:'https://ilinkai.weixin.qq.com',token:'test-only',botId:'audio-bot',ownerId:'audio-owner'};
const media={encrypt_query_param:'synthetic-cdn-param',aes_key:Buffer.alloc(16,1).toString('base64'),encrypt_type:1};
const item={type:3,voice_item:{media,encode_type:6,playtime:1000}};
const envelope={message_id:'9223372036854775807',message_type:1,message_state:2,from_user_id:c.ownerId,context_token:'context',create_time_ms:Date.now(),item_list:[item]};
function wav(){const pcm=Buffer.alloc(48000);for(let i=0;i<24000;i++)pcm.writeInt16LE(Math.round(Math.sin(i/8)*10000),i*2);return pcmToWav(pcm,24000);}
const row=(extra:Partial<WeixinRow>={}):WeixinRow=>({message_key:'a'.repeat(64),user_id:'owner',text:INCOMING_AUDIO_TEXT,context_token:'context',reply:null,stage:'pending',attempts:0,retry_at:new Date(0),source_created_ms:Date.now(),incoming_audio:parseIncomingAudio(item.voice_item),...extra});
const deps=():AudioInputDependencies=>({jobs:{get:vi.fn().mockResolvedValue(undefined),reserve:vi.fn().mockResolvedValue({fresh:true,job:{state:'reserved',source:'minimax',transcript:null}}),save:vi.fn(),discardMedia:vi.fn()},prepare:vi.fn().mockResolvedValue(wav()),validate:vi.fn(),transcribe:vi.fn().mockResolvedValue({text:'今天下雨了',durationMs:1000}),limit:10,activeSinceMs:Date.now()-1000});
describe('voice input: provenance, decoding and paid recognition fences',()=>{
 it('preserves exact identity, timestamp and completion rules for native voice',()=>{
  const r=extractIncoming(envelope,c)!;expect(r.text).toBe(INCOMING_AUDIO_TEXT);expect(r.audio?.codec).toBe('silk');expect(r.key).toMatch(/^[a-f0-9]{64}$/);
  for(const patch of [{from_user_id:'other'},{group_id:'group'},{message_state:1},{message_type:2},{delete_time_ms:1},{create_time_ms:undefined},{message_id:9223372036854776000},{item_list:[{...item,is_completed:false}]}])expect(extractIncoming({...envelope,...patch},c)).toBeNull();
 });
 it('uses native text without persisting media keys, rejects malformed/long/mixed audio and unsupported codecs',()=>{
  expect(parseIncomingAudio({...item.voice_item,text:' 今天下雨了 '})).toEqual({status:'native',nativeText:'今天下雨了',durationMs:1000});
  for(const value of [{...item.voice_item,playtime:30001},{...item.voice_item,playtime:-1},{...item.voice_item,encode_type:7},{...item.voice_item,media:{...media,full_url:'https://localhost/c2c/download'}},{...item.voice_item,encode_type:1,bits_per_sample:8,sample_rate:16000}])expect(parseIncomingAudio(value)).toEqual({status:'unsupported'});
  expect(extractIncoming({...envelope,item_list:[item,{type:1,text_item:{text:'关闭主动联系'}}]},c)?.audio?.status).toBe('unsupported');
 });
 it('recognizes only bounded canonical mono PCM16 WAV and rejects silence, wrong rate and spoofed lengths',()=>{
  expect(inspectAsrWav(wav())).toEqual({durationMs:1000,rate:24000});expect(()=>pcmToWav(Buffer.alloc(1),24000)).toThrow();expect(()=>pcmToWav(Buffer.alloc(48000*31),24000)).toThrow();expect(()=>inspectAsrWav(pcmToWav(Buffer.alloc(48000),24000))).toThrow('ASR_SILENCE');
  const bad=wav();bad.writeUInt32LE(1,40);expect(()=>inspectAsrWav(bad)).toThrow();const badRate=wav();badRate.writeUInt32LE(9999999,24);expect(()=>inspectAsrWav(badRate)).toThrow();
 });
 it('preflights SILK signatures, packet lengths and a hard packet cap before launching a decoder',()=>{
  for(const input of [Buffer.from('not audio'),Buffer.concat([Buffer.from([2]),Buffer.from('#!SILK_V3'),Buffer.from([255,127])]),Buffer.concat([Buffer.from([2]),Buffer.from('#!SILK_V3'),Buffer.from([0,0])])])expect(()=>inspectSilk(input)).toThrow();
  const frame=Buffer.from([1,0,1]),many=Buffer.concat([Buffer.from([2]),Buffer.from('#!SILK_V3'),...Array(1501).fill(frame)]);expect(()=>inspectSilk(many)).toThrow();
 });
 it('decrypts bounded PCM only from the trusted CDN, without credentials or redirects, and checks real duration',async()=>{
  const pcm=wav().subarray(44),key=Buffer.alloc(16,1),cipher=createCipheriv('aes-128-ecb',key,null),encrypted=Buffer.concat([cipher.update(pcm),cipher.final()]);
  const audio=parseIncomingAudio({...item.voice_item,encode_type:1,bits_per_sample:16,sample_rate:24000});
  const f=vi.fn(async()=>new Response(encrypted));expect(await prepareIncomingWav(audio,undefined,f)).toEqual(wav());expect(f.mock.calls[0][1]).toMatchObject({redirect:'error'});expect(f.mock.calls[0][1].headers).toBeUndefined();
  await expect(prepareIncomingWav({...audio,durationMs:5000},undefined,f)).rejects.toThrow('ASR_INVALID_AUDIO');
  const never=vi.fn();await expect(prepareIncomingWav({...audio,url:'https://127.0.0.1/c2c/download'},undefined,never)).rejects.toThrow();expect(never).not.toHaveBeenCalled();
  const oversized=vi.fn(async()=>new Response(encrypted,{headers:{'content-length':String(2*1024*1024+17)}}));await expect(prepareIncomingWav(audio,undefined,oversized)).rejects.toThrow('ASR_INVALID_AUDIO');
 });
 it('round-trips a real SILK fixture through the compiled isolated worker, bounds deadline/RSS, and leaves no worker alive',()=>{
  const code=`const {encode}=require('silk-wasm');const a=require(${JSON.stringify(resolve('core/infrastructure/dist/asr/audio.js'))});(async()=>{let p=Buffer.alloc(48000);for(let i=0;i<24000;i++)p.writeInt16LE(Math.round(Math.sin(i/8)*10000),i*2);const s=await encode(p,24000);const input=Buffer.from(s.data);const out=await a.decodeSilkWav(input,undefined,{maxParentRss:512*1024*1024});const info=a.inspectAsrWav(out);if(Math.abs(info.durationMs-1000)>30)throw Error('duration mismatch');try{await a.decodeSilkWav(input,undefined,{maxParentRss:0});throw Error('RSS guard missing');}catch(e){if(e.code!=='ASR_BUSY')throw e;}try{await a.decodeSilkWav(input,undefined,{timeoutMs:1,maxParentRss:512*1024*1024});throw Error('timeout guard missing');}catch(e){if(e.code!=='ASR_DECODE_TIMEOUT')throw e;}console.log(JSON.stringify({passed:true,durationMs:info.durationMs,codecBytes:input.length}));})().catch(()=>process.exitCode=1);`;
  const r=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:15000});expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout.trim())).toMatchObject({passed:true,durationMs:1000});
 });
 it('accepts exactly 30 seconds of decoded PCM despite codec framing delay',()=>{
  const code=`const {encode}=require('silk-wasm');const a=require(${JSON.stringify(resolve('core/infrastructure/dist/asr/audio.js'))});(async()=>{const pcm=Buffer.alloc(1440000);for(let i=0;i<720000;i++)pcm.writeInt16LE(Math.round(Math.sin(i/8)*10000),i*2);const s=await encode(pcm,24000);const out=await a.decodeSilkWav(Buffer.from(s.data),undefined,{maxParentRss:512*1024*1024});console.log(a.inspectAsrWav(out).durationMs);})().catch(()=>process.exitCode=1);`;
  const r=spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:15000});expect(r.status,r.stderr).toBe(0);expect(r.stdout.trim()).toBe('30000');
 });
 it('calls only the official ASR endpoint once with WAV multipart, no CDN reference, and no custom multipart boundary',async()=>{
  const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({text:'今天下雨了',duration:1,trace_id:'synthetic'})));const b=wav();expect(await new MiniMaxAsrProvider('asr-test','cn',f).transcribe(b)).toEqual({text:'今天下雨了',durationMs:1000});
  const [url,o]=f.mock.calls[0];expect(url).toBe('https://api.minimax.cn/v1/speech_to_text');expect(o.redirect).toBe('error');expect(o.headers).toEqual({Authorization:'Bearer asr-test'});expect(o.body.get('model')).toBe('asr-1.0');expect(o.body.get('response_format')).toBe('json');expect(Buffer.from(await o.body.get('file').arrayBuffer())).toEqual(b);expect(f).toHaveBeenCalledOnce();
 });
 it.each([400,401,402,403,429,500])('does not retry HTTP %i or expose provider bodies',async status=>{
  const f=vi.fn().mockResolvedValue(new Response('secret-body',{status}));await expect(new MiniMaxAsrProvider('key-not-logged','cn',f).transcribe(wav())).rejects.toBeInstanceOf(AsrError);expect(f).toHaveBeenCalledOnce();
 });
 it('rejects empty, oversized, control-bearing and duration-spoofed transcripts and unknown outcomes without retry',async()=>{
  for(const data of [null,{text:'',duration:1},{text:'x'.repeat(2001),duration:1},{text:'bad\u0001',duration:1},{text:'hello',duration:60},{text:'hello',duration:'1'}])await expect(new MiniMaxAsrProvider('test','cn',async()=>new Response(JSON.stringify(data))).transcribe(wav())).rejects.toThrow();
  const f=vi.fn().mockRejectedValue(Error('private-url'));await expect(new MiniMaxAsrProvider('test','cn',f).transcribe(wav())).rejects.toThrow('ASR_RESULT_UNKNOWN');expect(f).toHaveBeenCalledOnce();
 });
 it('holds speech controls for typed confirmation while allowing ordinary affectionate/daily speech',()=>{
  for(const t of ['关闭语音。','帮我记住我住在上海','发张自拍给我','开启主动联系','添加提醒：明天 12:00 | 带伞','确认语音 AABBCCDD','把主动联系关掉'])expect(audioNeedsTypedConfirmation(t),t).toBe(true);
  for(const t of ['今天下雨了','抱抱你','我记住你的话了','刚刚提醒同事带伞了'])expect(audioNeedsTypedConfirmation(t),t).toBe(false);
 });
 it('never uses voice/vision keys implicitly and requires explicit enablement time',()=>{
  expect(audioInputConfigured(loadConfig({ASR_ENABLED:'1',MINIMAX_VOICE_API_KEY:'voice-test',MINIMAX_VISION_API_KEY:'vision-test'}))).toBe(false);
  expect(audioInputConfigured(loadConfig({ASR_ENABLED:'1',MINIMAX_ASR_API_KEY:'asr-test',MINIMAX_ASR_REGION:'cn',ASR_ACTIVE_SINCE:new Date(Date.now()-1000).toISOString()}))).toBe(true);
 });
 it('uses cached recognition before config/download and never charges again after an abandoned reservation',async()=>{
  const d=deps();d.jobs.get=vi.fn().mockResolvedValue({state:'transcribed',source:'minimax',transcript:'已识别'});expect(await recognizeIncomingAudio(row(),d.jobs)).toEqual({ok:true,text:'已识别',source:'minimax'});expect(d.prepare).not.toHaveBeenCalled();
  d.jobs.get=vi.fn().mockResolvedValue({state:'reserved',source:'minimax',transcript:null});expect(await recognizeIncomingAudio(row(),d.jobs,d)).toEqual({ok:false,reply:AUDIO_UNCLEAR});expect(d.transcribe).not.toHaveBeenCalled();expect(d.jobs.save).toHaveBeenCalledWith(expect.anything(),'failed',null,'ASR_RESULT_UNKNOWN');
 });
 it('runs native text without download/provider, but rejects disabled/unsupported/old input before paid work',async()=>{
  const d=deps();d.jobs.reserve=vi.fn().mockResolvedValue({fresh:true,job:{state:'transcribed',source:'weixin',transcript:'微信转写'}});expect(await recognizeIncomingAudio(row({incoming_audio:{status:'native',nativeText:'微信转写'}}),d.jobs,d)).toEqual({ok:true,text:'微信转写',source:'weixin'});expect(d.prepare).not.toHaveBeenCalled();expect(d.transcribe).not.toHaveBeenCalled();
  expect(await recognizeIncomingAudio(row(),d.jobs)).toEqual({ok:false,reply:AUDIO_DISABLED});expect(await recognizeIncomingAudio(row({incoming_audio:{status:'unsupported'}}),d.jobs,d)).toEqual({ok:false,reply:AUDIO_UNSUPPORTED});expect(await recognizeIncomingAudio(row({source_created_ms:1}),d.jobs,d)).toEqual({ok:false,reply:AUDIO_UNCLEAR});
 });
 it('validates before reservation, persists successful recognition before Core, and does not retry failed result commits',async()=>{
  const d=deps(),events:string[]=[];d.prepare=vi.fn(async()=>{events.push('prepare');return wav();});d.jobs.reserve=vi.fn(async()=>{events.push('reserve');return {fresh:true};});d.transcribe=vi.fn(async()=>{events.push('provider');return {text:'今天下雨了',durationMs:1000};});d.jobs.save=vi.fn(async()=>{events.push('saved');});expect((await recognizeIncomingAudio(row(),d.jobs,d)).ok).toBe(true);expect(events).toEqual(['prepare','reserve','provider','saved']);
  d.jobs.save=vi.fn().mockRejectedValue(Error('commit failed'));await expect(recognizeIncomingAudio(row(),d.jobs,d)).rejects.toThrow('commit failed');expect(d.transcribe).toHaveBeenCalledTimes(2);
  d.jobs.get=vi.fn().mockResolvedValue({state:'reserved',source:'minimax',transcript:null});d.jobs.save=vi.fn();await recognizeIncomingAudio(row(),d.jobs,d);expect(d.transcribe).toHaveBeenCalledTimes(2);
 });
 it('never calls the provider on a failed decode or exhausted quota',async()=>{
  const d=deps();d.prepare=vi.fn().mockRejectedValue(new AsrError('ASR_INVALID_AUDIO'));expect(await recognizeIncomingAudio(row(),d.jobs,d)).toEqual({ok:false,reply:AUDIO_UNSUPPORTED});expect(d.jobs.reserve).not.toHaveBeenCalled();
  d.prepare=vi.fn().mockResolvedValue(wav());d.jobs.reserve=vi.fn().mockResolvedValue({fresh:false,denied:true});expect(await recognizeIncomingAudio(row(),d.jobs,d)).toEqual({ok:false,reply:AUDIO_LIMIT});expect(d.transcribe).not.toHaveBeenCalled();
 });
});
