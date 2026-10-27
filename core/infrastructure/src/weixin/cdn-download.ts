import {createDecipheriv} from 'node:crypto';
export interface EncryptedCdnMedia {url:string;aesKey:string}
export class CdnMediaError extends Error {constructor(readonly code:'UNTRUSTED_CDN'|'INVALID_MEDIA'|'DOWNLOAD_FAILED'){super(code);}}
export function trustedCdnDownload(value:string):string {
 try{if(value.length>18000)throw Error();const u=new URL(value);if(u.protocol!=='https:'||!['novac2c.cdn.weixin.qq.com','novac2c.cdn.wechat.com'].includes(u.hostname)||u.port||u.username||u.password||u.hash||u.pathname!=='/c2c/download')throw Error();return u.href;}catch{throw new CdnMediaError('UNTRUSTED_CDN');}
}
export function parseEncryptedCdnMedia(value:unknown,hexOverride?:unknown):EncryptedCdnMedia|undefined {
 try{
  if(!value||typeof value!=='object')return;const m=value as Record<string,unknown>;if(m.encrypt_type!==undefined&&m.encrypt_type!==1)return;
  let key:string;if(hexOverride!==undefined){if(typeof hexOverride!=='string'||!/^[a-fA-F0-9]{32}$/.test(hexOverride))return;key=hexOverride.toLowerCase();}
  else{if(typeof m.aes_key!=='string'||m.aes_key.length>64||!/^[A-Za-z0-9+/]+={0,2}$/.test(m.aes_key))return;const raw=Buffer.from(m.aes_key,'base64');if(raw.toString('base64')!==m.aes_key)return;if(raw.length===16)key=raw.toString('hex');else if(raw.length===32&&/^[a-fA-F0-9]{32}$/.test(raw.toString('ascii')))key=raw.toString('ascii').toLowerCase();else return;}
  let url:string;if(m.full_url!==undefined){if(typeof m.full_url!=='string')return;url=trustedCdnDownload(m.full_url);}else{if(typeof m.encrypt_query_param!=='string'||!m.encrypt_query_param||m.encrypt_query_param.length>16384)return;const u=new URL('https://novac2c.cdn.weixin.qq.com/c2c/download');u.searchParams.set('encrypted_query_param',m.encrypt_query_param);url=u.href;}return {url,aesKey:key};
 }catch{return;}
}
/** Bounded encrypted download; never forwards bot credentials or follows redirects. */
export async function downloadEncryptedCdn(media:EncryptedCdnMedia,maxBytes:number,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<Buffer>{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4*1024*1024||!/^[a-f0-9]{32}$/.test(media.aesKey))throw new CdnMediaError('INVALID_MEDIA');const url=trustedCdnDownload(media.url);let response:Response;
 try{response=await fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}catch{throw new CdnMediaError('DOWNLOAD_FAILED');}
 try{if(!response.ok||!response.body)throw new CdnMediaError('DOWNLOAD_FAILED');const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes+16))throw new CdnMediaError('INVALID_MEDIA');
  const chunks:Uint8Array[]=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes+16)throw new CdnMediaError('INVALID_MEDIA');chunks.push(chunk);}if(!size||size%16)throw new CdnMediaError('INVALID_MEDIA');
  let bytes:Buffer;try{const d=createDecipheriv('aes-128-ecb',Buffer.from(media.aesKey,'hex'),null);bytes=Buffer.concat([d.update(Buffer.concat(chunks)),d.final()]);}catch{throw new CdnMediaError('INVALID_MEDIA');}if(bytes.length>maxBytes)throw new CdnMediaError('INVALID_MEDIA');return bytes;
 }finally{if(!response.body?.locked)await response.body?.cancel().catch(()=>undefined);}
}
