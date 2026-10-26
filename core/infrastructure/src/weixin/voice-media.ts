import {randomBytes,createHash,createCipheriv} from 'node:crypto';
import {trustedCdnUpload} from './media.js';
import {validateMp3,VOICE_MAX_BYTES} from '../voice/files.js';
export interface WeixinVoiceFile{encryptQueryParam:string;aesKey:string;ciphertextSize:number;plaintextSize:number}
export function validWeixinVoiceFile(value:unknown):value is WeixinVoiceFile{
 if(!value||typeof value!=='object')return false;const v=value as WeixinVoiceFile;return typeof v.encryptQueryParam==='string'&&v.encryptQueryParam.length>0&&v.encryptQueryParam.length<=16384&&typeof v.aesKey==='string'&&/^[a-f0-9]{32}$/.test(v.aesKey)&&Number.isInteger(v.plaintextSize)&&v.plaintextSize>=4&&v.plaintextSize<=VOICE_MAX_BYTES&&Number.isInteger(v.ciphertextSize)&&v.ciphertextSize===16*(Math.floor(v.plaintextSize/16)+1);
}
/** FILE upload + FILE item. Native voice bubbles are deliberately not claimed supported. */
export async function uploadWeixinVoiceFile(client:{post(path:string,body:object,timeout?:number):Promise<Record<string,unknown>>;credentials:{ownerId:string}},bytes:Buffer,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<WeixinVoiceFile>{
 validateMp3(bytes);const key=randomBytes(16),filekey=randomBytes(16).toString('hex'),cipher=createCipheriv('aes-128-ecb',key,null),encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const grant=await client.post('getuploadurl',{filekey,media_type:3,to_user_id:client.credentials.ownerId,rawsize:bytes.length,rawfilemd5:createHash('md5').update(bytes).digest('hex'),filesize:encrypted.length,no_need_thumb:true,aeskey:key.toString('hex')},15000);
 let url:string;if(typeof grant.upload_full_url==='string'&&grant.upload_full_url.trim())url=trustedCdnUpload(grant.upload_full_url.trim());else if(typeof grant.upload_param==='string'&&grant.upload_param.length>0&&grant.upload_param.length<=16384){const u=new URL('https://novac2c.cdn.weixin.qq.com/c2c/upload');u.searchParams.set('encrypted_query_param',grant.upload_param);u.searchParams.set('filekey',filekey);url=u.href;}else throw Error('VOICE_UPLOAD_GRANT_MISSING');
 const response=await fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(encrypted),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});await response.body?.cancel();const param=response.headers.get('x-encrypted-param');if(response.status!==200||!param||param.length>16384)throw Error('VOICE_UPLOAD_FAILED');return {encryptQueryParam:param,aesKey:key.toString('hex'),ciphertextSize:encrypted.length,plaintextSize:bytes.length};
}
