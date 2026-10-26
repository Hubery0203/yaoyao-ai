import {VOICE_NAMES,voiceTextEligible,type VoiceName} from '@yaoyao/application';
import {validateMp3,VOICE_MAX_BYTES} from './files.js';
import {VoiceProviderError,type VoiceFailureCode} from './errors.js';
export type MiniMaxVoiceRegion='cn'|'international';
export type MiniMaxSpeechModel='speech-2.8-hd'|'speech-2.8-turbo';
export const MINIMAX_SYSTEM_VOICES:Record<VoiceName,string>={coral:'Chinese (Mandarin)_Warm_Bestie',marin:'Chinese (Mandarin)_Gentle_Senior',shimmer:'Chinese (Mandarin)_Soft_Girl'};
const origins={cn:'https://api.minimax.cn',international:'https://api.minimax.io'} as const;
function failure(status:number,code:unknown):VoiceFailureCode{
 if(code===1008||code===2053)return 'VOICE_CREDIT_EXHAUSTED';
 if(code===1004||code===2049||status===401||status===403)return 'VOICE_AUTH_FAILED';
 if([1002,1041,1045,2045,2046,2047].includes(code as number)||status===429)return 'VOICE_RATE_LIMITED';
 if(code===1001)return 'VOICE_RESULT_UNKNOWN';return 'VOICE_PROVIDER_FAILED';
}
/** Fixed region-specific origins, stock voice allowlist and inline hex audio; no URL downloads or retries. */
export class MiniMaxSpeechProvider{
 constructor(private readonly key:string,private readonly region:MiniMaxVoiceRegion,private readonly model:MiniMaxSpeechModel='speech-2.8-hd',private readonly fetcher:typeof fetch=fetch){}
 async generate(text:string,voice:VoiceName,signal?:AbortSignal):Promise<Buffer>{
  if(!this.key||!Object.hasOwn(origins,this.region)||!['speech-2.8-hd','speech-2.8-turbo'].includes(this.model)||!VOICE_NAMES.includes(voice)||!voiceTextEligible(text))throw new VoiceProviderError('VOICE_PROVIDER_FAILED');
  let response:Response;try{response=await this.fetcher(origins[this.region]+'/v1/t2a_v2',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,text,stream:false,language_boost:'Chinese',output_format:'hex',voice_setting:{voice_id:MINIMAX_SYSTEM_VOICES[voice],speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});}catch{throw new VoiceProviderError('VOICE_RESULT_UNKNOWN');}
  const max=response.ok?VOICE_MAX_BYTES*2+65536:16384,reader=response.body?.getReader(),parts:Uint8Array[]=[];let size=0,body:unknown;
  if(reader)try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max)break;parts.push(r.value);}if(size<=max)body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{/* Only finite diagnostic codes leave the adapter. */}finally{await reader.cancel().catch(()=>{});}
  const result=body as {base_resp?:{status_code?:unknown};data?:{audio?:unknown;status?:unknown};extra_info?:{audio_format?:unknown}}|undefined;
  const code=result?.base_resp?.status_code;if(!response.ok||code!==0)throw new VoiceProviderError(response.ok&&code===undefined?'VOICE_RESULT_UNKNOWN':failure(response.status,code));
  const hex=result?.data?.audio;
  if(result?.data?.status!==2||typeof hex!=='string'||hex.length<8||hex.length>VOICE_MAX_BYTES*2||hex.length%2!==0||!/^[a-fA-F0-9]+$/.test(hex)||result?.extra_info?.audio_format!==undefined&&result.extra_info.audio_format!=='mp3')throw new VoiceProviderError('VOICE_RESULT_UNKNOWN');
  try{const bytes=Buffer.from(hex,'hex');validateMp3(bytes);return bytes;}catch{throw new VoiceProviderError('VOICE_RESULT_UNKNOWN');}
 }
}
