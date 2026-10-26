import {voiceTextEligible,type VoiceName} from '@yaoyao/application';
import {validateMp3,VOICE_MAX_BYTES} from './files.js';
import {VoiceProviderError} from './errors.js';
export {VOICE_FAILURE_CODES,VoiceProviderError,type VoiceFailureCode} from './errors.js';
export class OpenAISpeechProvider{
 constructor(private readonly key:string,private readonly fetcher:typeof fetch=fetch){}
 async generate(text:string,voice:VoiceName,signal?:AbortSignal):Promise<Buffer>{
  if(!this.key||!['coral','marin','shimmer'].includes(voice)||!voiceTextEligible(text))throw new VoiceProviderError('VOICE_PROVIDER_FAILED');
  let response:Response;try{response=await this.fetcher('https://api.openai.com/v1/audio/speech',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini-tts',voice,input:text,response_format:'mp3',instructions:'用自然、轻柔的普通话说出原文，像日常聊天。语速适中，不播音，不夸张表演。不增添开场、解释或任何额外文字。'}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});}catch{throw new VoiceProviderError('VOICE_RESULT_UNKNOWN');}
  if(!response.ok){
   let code='';const reader=response.body?.getReader();let size=0;const parts:Uint8Array[]=[];
   if(reader)try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>16384)break;parts.push(r.value);}if(size<=16384){const body=JSON.parse(Buffer.concat(parts).toString('utf8'));if(typeof body?.error?.code==='string')code=body.error.code;}}catch{/* No raw error body survives. */}finally{await reader.cancel().catch(()=>{});}
   throw new VoiceProviderError(['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached'].includes(code)&&[400,403,429].includes(response.status)?'VOICE_CREDIT_EXHAUSTED':response.status===429?'VOICE_RATE_LIMITED':[401,403].includes(response.status)?'VOICE_AUTH_FAILED':'VOICE_PROVIDER_FAILED');
  }
  if(!response.body)throw new VoiceProviderError('VOICE_RESULT_UNKNOWN');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>VOICE_MAX_BYTES)throw Error('AUDIO_LIMIT');parts.push(r.value);}const bytes=Buffer.concat(parts);validateMp3(bytes);return bytes;}catch{throw new VoiceProviderError('VOICE_RESULT_UNKNOWN');}finally{await reader.cancel().catch(()=>{});}
 }
}
