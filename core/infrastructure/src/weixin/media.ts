import {randomBytes,createHash,createCipheriv} from 'node:crypto';
import {imageMime,PHOTO_MAX_BYTES} from '../photos/files.js';
export interface WeixinImage {encryptQueryParam:string;aesKey:string;ciphertextSize:number}
export function validWeixinImage(v:unknown):v is WeixinImage{
 if(!v||typeof v!=='object')return false;const m=v as WeixinImage;
 return typeof m.encryptQueryParam==='string'&&m.encryptQueryParam.length>0&&m.encryptQueryParam.length<=16384&&typeof m.aesKey==='string'&&/^[a-f0-9]{32}$/.test(m.aesKey)&&Number.isInteger(m.ciphertextSize)&&m.ciphertextSize>0&&m.ciphertextSize<=PHOTO_MAX_BYTES+16;
}
export function trustedCdnUpload(value:string):string{
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='novac2c.cdn.weixin.qq.com'||u.port||u.username||u.password||u.hash||u.pathname!=='/c2c/upload')throw Error('UNTRUSTED_PHOTO_CDN');return u.href;
}
/** Protocol reference: Tencent/openclaw-weixin media upload/send. Keys never appear in logs. */
export async function uploadWeixinImage(client:{post(path:string,body:object,timeout?:number):Promise<Record<string,unknown>>;credentials:{ownerId:string}},bytes:Buffer,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<WeixinImage>{
 if(bytes.length>PHOTO_MAX_BYTES)throw Error('PHOTO_TOO_LARGE');imageMime(bytes);
 const key=randomBytes(16),filekey=randomBytes(16).toString('hex'),cipher=createCipheriv('aes-128-ecb',key,null),encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const grant=await client.post('getuploadurl',{filekey,media_type:1,to_user_id:client.credentials.ownerId,rawsize:bytes.length,rawfilemd5:createHash('md5').update(bytes).digest('hex'),filesize:encrypted.length,no_need_thumb:true,aeskey:key.toString('hex')},15000);
 let url:string;
 if(typeof grant.upload_full_url==='string'&&grant.upload_full_url.trim())url=trustedCdnUpload(grant.upload_full_url.trim());
 else if(typeof grant.upload_param==='string'&&grant.upload_param.length>0&&grant.upload_param.length<=16384){const u=new URL('https://novac2c.cdn.weixin.qq.com/c2c/upload');u.searchParams.set('encrypted_query_param',grant.upload_param);u.searchParams.set('filekey',filekey);url=u.href;}
 else throw Error('PHOTO_UPLOAD_GRANT_MISSING');
 const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(encrypted),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
 await response.body?.cancel();const param=response.headers.get('x-encrypted-param');
 if(response.status!==200||!param||param.length>16384)throw Error('PHOTO_UPLOAD_FAILED');
 return {encryptQueryParam:param,aesKey:key.toString('hex'),ciphertextSize:encrypted.length};
}
