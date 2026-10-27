import {AUDIO_BUSY,AUDIO_DISABLED,AUDIO_LIMIT,AUDIO_UNCLEAR,AUDIO_UNSUPPORTED} from '@yaoyao/application';
import {WeixinAudioStore,MiniMaxAsrProvider,prepareIncomingWav,AsrError,type AppConfig,type AsrTranscript,type WeixinStore,type WeixinRow} from '@yaoyao/infrastructure';
export interface AudioInputDependencies {
 jobs:Pick<WeixinAudioStore,'get'|'reserve'|'save'|'discardMedia'>;
 prepare:()=>Promise<Buffer>;validate:(bytes:Buffer)=>void;transcribe:(bytes:Buffer)=>Promise<AsrTranscript>;
 limit:number;activeSinceMs:number;
}
export type AudioInputResult={ok:true;text:string;source:'weixin'|'minimax'}|{ok:false;reply:string};
export function audioInputConfigured(c:AppConfig):boolean{return c.ASR_ENABLED==='1'&&!!c.MINIMAX_ASR_API_KEY?.trim()&&!!c.MINIMAX_ASR_REGION&&!!c.ASR_ACTIVE_SINCE&&Date.parse(c.ASR_ACTIVE_SINCE)<=Date.now();}
export async function recognizeIncomingAudio(row:WeixinRow,jobs:AudioInputDependencies['jobs'],deps?:AudioInputDependencies):Promise<AudioInputResult>{
 const prior=await jobs.get(row);if(prior?.state==='transcribed'&&prior.transcript)return {ok:true,text:prior.transcript,source:prior.source};
 if(prior){if(prior.state==='reserved')await jobs.save(row,'failed',null,'ASR_RESULT_UNKNOWN');return {ok:false,reply:AUDIO_UNCLEAR};}
 if(!deps){await jobs.discardMedia(row);return {ok:false,reply:AUDIO_DISABLED};}
 const time=Number(row.source_created_ms);if(!Number.isSafeInteger(time)||time<deps.activeSinceMs||time<Date.now()-600000){await jobs.discardMedia(row);return {ok:false,reply:AUDIO_UNCLEAR};}
 if(row.incoming_audio?.status==='native'){
  const r=await jobs.reserve(row,deps.limit,deps.activeSinceMs,'weixin');if(r.job?.transcript)return {ok:true,text:r.job.transcript,source:'weixin'};
  await jobs.discardMedia(row);return {ok:false,reply:AUDIO_UNCLEAR};
 }
 if(row.incoming_audio?.status!=='ready'){await jobs.discardMedia(row);return {ok:false,reply:AUDIO_UNSUPPORTED};}
 let bytes:Buffer;try{bytes=await deps.prepare();deps.validate(bytes);}catch(e){await jobs.discardMedia(row);return {ok:false,reply:e instanceof AsrError&&e.code==='ASR_BUSY'?AUDIO_BUSY:e instanceof AsrError&&e.code==='ASR_INVALID_AUDIO'?AUDIO_UNSUPPORTED:AUDIO_UNCLEAR};}
 const r=await jobs.reserve(row,deps.limit,deps.activeSinceMs,'minimax');if(r.denied){await jobs.discardMedia(row);return {ok:false,reply:AUDIO_LIMIT};}
 if(!r.fresh)return r.job?.transcript?{ok:true,text:r.job.transcript,source:r.job.source}:{ok:false,reply:AUDIO_UNCLEAR};
 let result:AsrTranscript;try{result=await deps.transcribe(bytes);}catch(e){await jobs.save(row,'failed',null,e instanceof AsrError?e.code:'ASR_RESULT_UNKNOWN');return {ok:false,reply:AUDIO_UNCLEAR};}
 await jobs.save(row,'transcribed',result.text);return {ok:true,text:result.text,source:'minimax'};
}
export function createAudioInputDependencies(c:AppConfig,store:WeixinStore,row:WeixinRow,signal:AbortSignal):AudioInputDependencies|undefined {
 if(!audioInputConfigured(c))return;const provider=new MiniMaxAsrProvider(c.MINIMAX_ASR_API_KEY!,c.MINIMAX_ASR_REGION!);
 return {jobs:new WeixinAudioStore(store),prepare:()=>prepareIncomingWav(row.incoming_audio!,signal),validate:b=>provider.validate(b),transcribe:b=>provider.transcribe(b,signal),limit:c.ASR_MAX_PER_24H,activeSinceMs:Date.parse(c.ASR_ACTIVE_SINCE!)};
}
