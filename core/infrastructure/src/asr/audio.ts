import {spawn} from 'node:child_process';
import {join} from 'node:path';
export const AUDIO_MAX_BYTES=2*1024*1024,AUDIO_MAX_MS=30000;
export class AsrError extends Error {constructor(readonly code:string){super(code);}}
export function pcmToWav(pcm:Buffer,rate:number):Buffer {
 if(![8000,12000,16000,24000,32000,48000].includes(rate)||!pcm.length||pcm.length%2||pcm.length/rate/2*1000>AUDIO_MAX_MS)throw new AsrError('ASR_INVALID_AUDIO');
 const out=Buffer.alloc(44+pcm.length);out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(pcm.length,40);pcm.copy(out,44);return out;
}
export function inspectAsrWav(bytes:Buffer):{durationMs:number;rate:number} {
 if(bytes.length<46||bytes.length>AUDIO_MAX_BYTES+44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,16)!=='WAVEfmt '||bytes.readUInt32LE(16)!==16||bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(22)!==1||bytes.readUInt16LE(32)!==2||bytes.readUInt16LE(34)!==16||bytes.toString('ascii',36,40)!=='data'||bytes.readUInt32LE(40)!==bytes.length-44)throw new AsrError('ASR_INVALID_AUDIO');
 const rate=bytes.readUInt32LE(24),durationMs=(bytes.length-44)/2/rate*1000;if(![8000,12000,16000,24000,32000,48000].includes(rate)||bytes.readUInt32LE(28)!==rate*2||!Number.isFinite(durationMs)||durationMs<100||durationMs>AUDIO_MAX_MS||(bytes.length-44)%2)throw new AsrError('ASR_INVALID_AUDIO');
 let peak=0;for(let i=44;i<bytes.length;i+=2)peak=Math.max(peak,Math.abs(bytes.readInt16LE(i)));if(peak<16)throw new AsrError('ASR_SILENCE');return {durationMs,rate};
}
/** Bound packet count before WASM; decoded bytes are checked again in the codec process. */
export function inspectSilk(bytes:Buffer):number {
 if(bytes.length<12||bytes.length>AUDIO_MAX_BYTES)throw new AsrError('ASR_INVALID_AUDIO');let offset=bytes[0]===2?10:9;
 if(bytes.toString('ascii',bytes[0]===2?1:0,offset)!=='#!SILK_V3')throw new AsrError('ASR_INVALID_AUDIO');let packets=0;
 while(offset<bytes.length){if(offset+2>bytes.length)throw new AsrError('ASR_INVALID_AUDIO');const size=bytes.readInt16LE(offset);offset+=2;if(size===-1&&offset===bytes.length)break;if(size<1||size>4096||offset+size>bytes.length||++packets>1500)throw new AsrError('ASR_INVALID_AUDIO');offset+=size;}
 if(!packets)throw new AsrError('ASR_INVALID_AUDIO');return packets;
}
export async function decodeSilkWav(bytes:Buffer,signal?:AbortSignal,options:{timeoutMs?:number;maxParentRss?:number}={}):Promise<Buffer>{
 inspectSilk(bytes);if(signal?.aborted)throw new AsrError('ASR_ABORTED');if(process.memoryUsage().rss>(options.maxParentRss??112*1024*1024))throw new AsrError('ASR_BUSY');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=24','--max-semi-space-size=4',join(__dirname,'silk-process.js')],{env:{},stdio:['pipe','pipe','ignore'],windowsHide:true});
  let failure:AsrError|undefined,size=0;const chunks:Buffer[]=[];
  const stop=(error:AsrError)=>{failure??=error;child.kill('SIGKILL');};
  const aborted=()=>stop(new AsrError('ASR_ABORTED')),timer=setTimeout(()=>stop(new AsrError('ASR_DECODE_TIMEOUT')),options.timeoutMs??5000);signal?.addEventListener('abort',aborted,{once:true});
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1440000)stop(new AsrError('ASR_INVALID_AUDIO'));else chunks.push(chunk);});
  child.once('error',()=>stop(new AsrError('ASR_INVALID_AUDIO')));child.stdin.on('error',()=>stop(new AsrError('ASR_INVALID_AUDIO')));
  child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);if(failure)return reject(failure);try{if(code!==0)throw Error();const wav=pcmToWav(Buffer.concat(chunks),24000);inspectAsrWav(wav);resolve(wav);}catch{reject(new AsrError('ASR_INVALID_AUDIO'));}});
  child.stdin.end(bytes);
 });
}
