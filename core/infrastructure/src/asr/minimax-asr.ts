import {AsrError,inspectAsrWav} from './audio.js';
export interface AsrTranscript {text:string;durationMs:number}
/** Official multipart /v1/speech_to_text; no SDK fallback or automatic retry. */
export class MiniMaxAsrProvider {
 constructor(private readonly key:string,private readonly region:'cn'|'international',private readonly fetcher:typeof fetch=fetch){}
 validate(bytes:Buffer):void {if(!this.key.trim()||!['cn','international'].includes(this.region))throw new AsrError('ASR_NOT_CONFIGURED');inspectAsrWav(bytes);}
 async transcribe(bytes:Buffer,signal?:AbortSignal):Promise<AsrTranscript>{
  this.validate(bytes);const expected=inspectAsrWav(bytes),form=new FormData();form.append('model','asr-1.0');form.append('response_format','json');form.append('stream','false');form.append('file',new Blob([new Uint8Array(bytes)],{type:'audio/wav'}),'voice.wav');
  let response:Response;try{response=await this.fetcher((this.region==='cn'?'https://api.minimax.cn':'https://api.minimax.io')+'/v1/speech_to_text',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+this.key},body:form,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});}catch{throw new AsrError('ASR_RESULT_UNKNOWN');}
  try{
   if(!response.ok)throw new AsrError([401,403].includes(response.status)?'ASR_AUTH':response.status===402?'ASR_CREDIT_EXHAUSTED':response.status===429?'ASR_RATE_LIMITED':'ASR_PROVIDER_FAILED');if(!response.body)throw new AsrError('ASR_EMPTY_RESPONSE');let size=0;const chunks:Uint8Array[]=[];
   for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw new AsrError('ASR_RESPONSE_TOO_LARGE');chunks.push(chunk);}let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AsrError('ASR_INVALID_JSON');}
   if(typeof data?.text!=='string'||!data.text.trim()||data.text.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(data.text)||typeof data.duration!=='number'||!Number.isFinite(data.duration)||data.duration<=0||data.duration>30||Math.abs(data.duration*1000-expected.durationMs)>1500)throw new AsrError('ASR_INVALID_TRANSCRIPT');
   return {text:data.text.trim(),durationMs:data.duration*1000};
  }finally{if(!response.body?.locked)await response.body?.cancel().catch(()=>undefined);}
 }
}
