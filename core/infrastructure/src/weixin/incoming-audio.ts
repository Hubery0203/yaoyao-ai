import {AUDIO_MAX_BYTES,AUDIO_MAX_MS,AsrError,decodeSilkWav,pcmToWav,inspectAsrWav} from '../asr/audio.js';
import {downloadEncryptedCdn,parseEncryptedCdnMedia,CdnMediaError} from './cdn-download.js';
export interface IncomingAudio {
 status:'ready'|'native'|'unsupported'|'consumed';url?:string;aesKey?:string;
 codec?:'silk'|'pcm';sampleRate?:number;durationMs?:number;nativeText?:string;
}
export function parseIncomingAudio(value:unknown):IncomingAudio {
 if(!value||typeof value!=='object')return {status:'unsupported'};const v=value as Record<string,unknown>;
 const duration=v.playtime;if(duration!==undefined&&(typeof duration!=='number'||!Number.isSafeInteger(duration)||duration<=0||duration>AUDIO_MAX_MS))return {status:'unsupported'};
 if(typeof v.text==='string'&&v.text.trim()&&v.text.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v.text))return {status:'native',nativeText:v.text.trim(),...(duration===undefined?{}:{durationMs:duration as number})};
 const media=parseEncryptedCdnMedia(v.media);if(!media||![1,6].includes(v.encode_type as number))return {status:'unsupported'};
 if(v.encode_type===1&&(![8000,12000,16000,24000,32000,48000].includes(v.sample_rate as number)||v.bits_per_sample!==16))return {status:'unsupported'};
 return {status:'ready',...media,codec:v.encode_type===6?'silk':'pcm',...(v.encode_type===1?{sampleRate:v.sample_rate as number}:{}),...(duration===undefined?{}:{durationMs:duration as number})};
}
export async function prepareIncomingWav(audio:IncomingAudio,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<Buffer>{
 if(audio.status!=='ready'||!audio.url||!audio.aesKey)throw new AsrError('ASR_INVALID_AUDIO');let bytes:Buffer;
 try{bytes=await downloadEncryptedCdn({url:audio.url,aesKey:audio.aesKey},AUDIO_MAX_BYTES,fetcher,signal);}catch(e){throw new AsrError(e instanceof CdnMediaError&&e.code==='INVALID_MEDIA'?'ASR_INVALID_AUDIO':'ASR_DOWNLOAD_FAILED');}
 const wav=audio.codec==='silk'?await decodeSilkWav(bytes,signal):audio.codec==='pcm'?pcmToWav(bytes,audio.sampleRate!):null;if(!wav)throw new AsrError('ASR_INVALID_AUDIO');const info=inspectAsrWav(wav);
 if(audio.durationMs!==undefined&&Math.abs(info.durationMs-audio.durationMs)>1000)throw new AsrError('ASR_INVALID_AUDIO');return wav;
}
