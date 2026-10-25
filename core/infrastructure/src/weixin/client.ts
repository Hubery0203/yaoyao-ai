import {validWeixinImage,type WeixinImage} from './media.js';
import {randomBytes,createHash} from 'node:crypto';
export interface WeixinCredentials {base:string;token:string;botId:string;ownerId:string}
export interface IncomingText {key:string;text:string;contextToken:string;time:number}
export class WeixinError extends Error {constructor(readonly code:string){super(code);}}
export function trustedWeixinBase(value:string):string {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname==='weixin.qq.com'||u.hostname.endsWith('.weixin.qq.com'))||u.search||u.hash||u.pathname!=='/')throw new WeixinError('UNTRUSTED_ORIGIN');
 return u.origin;
}
export function parseWeixin(raw:string):Record<string,unknown> {
 const data=JSON.parse(raw,((key:string,value:unknown,context?:{source?:string})=>{
  if(key==='message_id'&&typeof value==='number'&&!Number.isSafeInteger(value)){
   if(context?.source&&/^\d+$/.test(context.source))return context.source;
   throw new WeixinError('UNSAFE_MESSAGE_ID');
  }return value;
 }) as Parameters<typeof JSON.parse>[1]);
 if(!data||typeof data!=='object'||Array.isArray(data))throw new WeixinError('INVALID_RESPONSE');
 for(const k of ['ret','errcode'])if(data[k]!==undefined&&data[k]!==0)throw new WeixinError(data[k]===-14?'AUTH_EXPIRED':'API_REJECTED');
 return data;
}
export function extractText(value:unknown,c:WeixinCredentials):IncomingText|null {
 if(!value||typeof value!=='object')return null;
 const m=value as Record<string,unknown>;
 if(m.message_type!==1||m.group_id||m.delete_time_ms||m.message_state!==2||m.from_user_id!==c.ownerId||typeof m.context_token!=='string'||!m.context_token||m.context_token.length>16384)return null;
 if(!Array.isArray(m.item_list)||m.item_list.length!==1)return null;
 const item=m.item_list[0];const text=item?.text_item?.text;
 if(item?.type!==1||item.is_completed===false||typeof text!=='string'||!text.trim()||text.length>4000)return null;
 const id=m.message_id;
 if(!(typeof id==='string'&&/^\d{1,128}$/.test(id))&&!(typeof id==='number'&&Number.isSafeInteger(id)&&id>=0))return null;
 // Missing or invalid timestamps fail closed: pre-activation messages must never be replayed.
 const time=m.create_time_ms;
 if(typeof time!=='number'||!Number.isSafeInteger(time)||time<=0)return null;
 return {key:createHash('sha256').update(JSON.stringify([c.botId,c.ownerId,String(id)])).digest('hex'),text,contextToken:m.context_token,time};
}
export class WeixinClient {
 private readonly abort=new AbortController();
 constructor(readonly credentials:WeixinCredentials,private readonly fetcher:typeof fetch=fetch){trustedWeixinBase(credentials.base);}
 close():void {this.abort.abort();}
 async post(path:string,body:object,timeout=35000):Promise<Record<string,unknown>> {
  const c=this.credentials;
  const response=await this.fetcher(trustedWeixinBase(c.base)+'/ilink/bot/'+path,{
   method:'POST',redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(timeout)]),
   headers:{'Content-Type':'application/json','iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|10),AuthorizationType:'ilink_bot_token',Authorization:'Bearer '+c.token,'X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')},
   body:JSON.stringify({...body,base_info:{channel_version:'2.4.10',bot_agent:'YaoYaoW23/1.0'}}),
  });
  if(!response.ok){await response.body?.cancel();throw new WeixinError([401,403].includes(response.status)?'AUTH_EXPIRED':response.status===429?'RATE_LIMITED':'HTTP_ERROR');}
  if(!response.body)throw new WeixinError('EMPTY_RESPONSE');
  const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>524288)throw new WeixinError('RESPONSE_TOO_LARGE');chunks.push(chunk);}
  return parseWeixin(Buffer.concat(chunks).toString('utf8'));
 }
 sendImage(key:string,contextToken:string,media:WeixinImage){if(!validWeixinImage(media))throw new WeixinError('INVALID_PHOTO_MEDIA');return this.post('sendmessage',{msg:{from_user_id:'',to_user_id:this.credentials.ownerId,client_id:'yaoyao-photo-'+key,message_type:2,message_state:2,context_token:contextToken,item_list:[{type:2,image_item:{media:{encrypt_query_param:media.encryptQueryParam,aes_key:Buffer.from(media.aesKey,'ascii').toString('base64'),encrypt_type:1},mid_size:media.ciphertextSize}}]}},15000);}
 send(key:string,contextToken:string,text:string){return this.post('sendmessage',{msg:{from_user_id:'',to_user_id:this.credentials.ownerId,client_id:'yaoyao-'+key,message_type:2,message_state:2,context_token:contextToken,item_list:[{type:1,text_item:{text}}]}},15000);}
}
