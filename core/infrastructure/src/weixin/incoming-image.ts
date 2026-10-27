import {createDecipheriv} from 'node:crypto';
import {inspectVisionImage,VISION_MAX_BYTES,VisionError} from '../vision/image-input.js';
export type IncomingImage={status:'ready';url:string;aesKey:string}|{status:'unsupported'|'consumed'};
/** Only Tencent CDN downloads; no arbitrary URL, redirect, credentials, or bot token. */
export function trustedCdnDownload(value:string):string {
 try{
  if(value.length>18000)throw Error();const u=new URL(value);
  if(u.protocol!=='https:'||!['novac2c.cdn.weixin.qq.com','novac2c.cdn.wechat.com'].includes(u.hostname)||u.port||u.username||u.password||u.hash||u.pathname!=='/c2c/download')throw Error();
  return u.href;
 }catch{throw new VisionError('UNTRUSTED_IMAGE_CDN');}
}
function aesKey(value:unknown):string {
 if(typeof value!=='string'||value.length>64||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new VisionError('INVALID_IMAGE_KEY');
 const raw=Buffer.from(value,'base64');
 if(raw.toString('base64')!==value)throw new VisionError('INVALID_IMAGE_KEY');
 if(raw.length===16)return raw.toString('hex');
 if(raw.length===32&&/^[a-fA-F0-9]{32}$/.test(raw.toString('ascii')))return raw.toString('ascii').toLowerCase();
 throw new VisionError('INVALID_IMAGE_KEY');
}
/** Tencent image_item.aeskey (hex) takes precedence over media.aes_key (base64). */
export function parseIncomingImage(value:unknown):IncomingImage {
 try{
  if(!value||typeof value!=='object')throw Error();const item=value as Record<string,unknown>,m=item.media as Record<string,unknown>|undefined;
  if(!m||typeof m!=='object'||m.encrypt_type!==undefined&&m.encrypt_type!==1)throw Error();
  let key:string;if(item.aeskey!==undefined){if(typeof item.aeskey!=='string'||!/^[a-fA-F0-9]{32}$/.test(item.aeskey))throw Error();key=item.aeskey.toLowerCase();}else key=aesKey(m.aes_key);
  let url:string;
  if(m.full_url!==undefined){if(typeof m.full_url!=='string')throw Error();url=trustedCdnDownload(m.full_url);}
  else{if(typeof m.encrypt_query_param!=='string'||!m.encrypt_query_param||m.encrypt_query_param.length>16384)throw Error();const u=new URL('https://novac2c.cdn.weixin.qq.com/c2c/download');u.searchParams.set('encrypted_query_param',m.encrypt_query_param);url=u.href;}
  return {status:'ready',url,aesKey:key};
 }catch{return {status:'unsupported'};}
}
export async function downloadWeixinImage(image:IncomingImage,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<Buffer>{
 if(image.status!=='ready'||!/^[a-f0-9]{32}$/.test(image.aesKey))throw new VisionError('INVALID_IMAGE');
 const url=trustedCdnDownload(image.url);let response:Response;
 try{response=await fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}catch{throw new VisionError('IMAGE_DOWNLOAD_FAILED');}
 try{
  if(!response.ok||!response.body)throw new VisionError('IMAGE_DOWNLOAD_FAILED');
  const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>VISION_MAX_BYTES+16))throw new VisionError('INVALID_IMAGE');
  const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>VISION_MAX_BYTES+16)throw new VisionError('INVALID_IMAGE');chunks.push(chunk);}
  if(!size||size%16)throw new VisionError('INVALID_IMAGE');
  let bytes:Buffer;try{const d=createDecipheriv('aes-128-ecb',Buffer.from(image.aesKey,'hex'),null);bytes=Buffer.concat([d.update(Buffer.concat(chunks)),d.final()]);}catch{throw new VisionError('INVALID_IMAGE');}
  inspectVisionImage(bytes);return bytes;
 }finally{if(!response.body?.locked)await response.body?.cancel().catch(()=>undefined);}
}
