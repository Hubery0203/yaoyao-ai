import {VoiceFiles,MiniMaxSpeechProvider,WeixinVoiceStore,VoiceProviderError,uploadWeixinVoiceFile,type AppConfig,type WeixinStore,type WeixinClient,type WeixinRow,type VoiceJob,type WeixinVoiceFile} from '@yaoyao/infrastructure';
export interface VoiceDependencies{
 jobs:Pick<WeixinVoiceStore,'reserve'|'save'|'canUpload'>;files:Pick<VoiceFiles,'available'|'save'|'read'>;
 generate:(text:string,voice:VoiceJob['voice'])=>Promise<Buffer>;upload:(bytes:Buffer)=>Promise<WeixinVoiceFile>;limit:number;
}
/** Reserves before synthesis, never regenerates an unknown attempt, and never changes the Core reply. */
export async function prepareWeixinVoice(row:WeixinRow,reply:string,deps:VoiceDependencies):Promise<void>{
 try{await deps.files.available();}catch{return;}
 const {job,fresh}=await deps.jobs.reserve(row,reply,deps.limit);if(!job)return;let current=job;
 if(current.state==='reserved'){
  if(!fresh){await deps.jobs.save(row,'failed',null,null,'VOICE_RESULT_UNKNOWN');return;}
  let artifact:string;try{artifact=await deps.files.save(await deps.generate(reply,current.voice));}catch(e){await deps.jobs.save(row,'failed',null,null,e instanceof VoiceProviderError?e.code:'VOICE_RESULT_UNKNOWN');return;}
  // A DB save failure must propagate: retry cannot authorize another paid synthesis.
  await deps.jobs.save(row,'generated',artifact);current={...current,state:'generated',artifact};
 }
 if(current.state==='generated'){
  if(!await deps.jobs.canUpload(row,reply))return;
  let bytes:Buffer;try{if(!current.artifact)throw Error('VOICE_ARTIFACT_MISSING');bytes=await deps.files.read(current.artifact);}catch{await deps.jobs.save(row,'failed',null,null,'VOICE_ARTIFACT_MISSING');return;}
  // Upload may retry from saved bytes; it never spends another synthesis request.
  let media:WeixinVoiceFile;try{media=await deps.upload(bytes);}catch(e){if(row.attempts>=3){await deps.jobs.save(row,'failed',null,null,'VOICE_PROVIDER_FAILED');return;}throw e;}await deps.jobs.save(row,'uploaded',null,media);
 }
}
export function voiceConfigured(config:AppConfig):boolean{return config.VOICE_ENABLED==='1'&&!!config.MINIMAX_VOICE_API_KEY&&!!config.MINIMAX_VOICE_REGION&&!!config.VOICE_STORAGE_DIR;}
export function createVoiceDependencies(config:AppConfig,store:WeixinStore,client:WeixinClient,signal:AbortSignal):VoiceDependencies|undefined{
 if(!voiceConfigured(config))return;const provider=new MiniMaxSpeechProvider(config.MINIMAX_VOICE_API_KEY!,config.MINIMAX_VOICE_REGION!,config.MINIMAX_VOICE_MODEL);
 return {jobs:new WeixinVoiceStore(store,config.VOICE_COOLDOWN_SECONDS),files:new VoiceFiles(config.VOICE_STORAGE_DIR!),generate:(text,voice)=>provider.generate(text,voice,signal),upload:bytes=>uploadWeixinVoiceFile(client,bytes,fetch,signal),limit:config.VOICE_MAX_PER_24H};
}
