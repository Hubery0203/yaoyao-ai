/** W-1 bounded personal Weixin text probe. No OpenClaw, model, DB or HTTP listener. */
import{randomBytes,createHash}from'node:crypto';
import{readFile,writeFile,rename,mkdir,chmod,stat,unlink}from'node:fs/promises';
import{resolve}from'node:path';import{pathToFileURL}from'node:url';
export const VERSION='2.4.10';const APP_VERSION=(2<<16)|(4<<8)|10;
export const BASE='https://ilinkai.weixin.qq.com';
export function trustedBase(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname==='weixin.qq.com'||u.hostname.endsWith('.weixin.qq.com'))||u.search||u.hash||u.pathname!=='/')throw Error('UNTRUSTED_WEIXIN_ORIGIN');return u.origin;}
export function success(data,strict=false){if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_RESPONSE');for(const k of ['ret','errcode'])if(data[k]!==undefined&&data[k]!==0)throw Error(data[k]===-14?'AUTH_EXPIRED':'API_REJECTED');if(strict&&data.ret!==0)throw Error('ACK_UNCERTAIN');return data;}
export class Client{
 constructor(fetcher=fetch){this.fetcher=fetcher;}
 async request(base,path,{token,body,timeout=35000}={}){
  const headers={'iLink-App-Id':'bot','iLink-App-ClientVersion':String(APP_VERSION)};
  const method=body===undefined?'GET':'POST';
  if(method==='POST'){Object.assign(headers,{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token','X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')});if(token)headers.Authorization='Bearer '+token;}
  const url=trustedBase(base)+'/'+path;
  const response=await this.fetcher(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error('HTTP_'+response.status);
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>524288){await response.body.cancel?.().catch(()=>{});throw Error('RESPONSE_TOO_LARGE');}chunks.push(chunk);}
  try{return success(JSON.parse(Buffer.concat(chunks).toString('utf8'),(key,value,context)=>{if(key==='message_id'&&typeof value==='number'&&!Number.isSafeInteger(value)){if(context?.source&&/^\d+$/.test(context.source))return context.source;throw Error('UNSAFE_MESSAGE_ID');}return value;}));}catch(e){if(['API_REJECTED','AUTH_EXPIRED','INVALID_RESPONSE'].includes(e.message))throw e;throw Error('INVALID_JSON');}
 }
 post(base,path,token,body){return this.request(base,path,{token,body:{...body,base_info:{channel_version:VERSION,bot_agent:'YaoYaoW1/0.1'}}});}
}
export function inbound(message,credentials,challenge){
 if(!message||message.message_type!==1||message.group_id||message.delete_time_ms||message.message_state===1||message.from_user_id!==credentials.ownerId||!message.context_token)return null;
 if(!Array.isArray(message.item_list)||message.item_list.length!==1||message.item_list[0].type!==1||message.item_list[0].is_completed===false)return null;
 const text=message.item_list[0].text_item?.text;if(typeof text!=='string'||text.normalize('NFKC').trim().toUpperCase()!==challenge)return null;
 const id=message.message_id;
 if(!(typeof id==='string'&&id.length>0&&id.length<=128)&&!(typeof id==='number'&&Number.isSafeInteger(id)&&id>=0))return null;
 return{key:createHash('sha256').update(JSON.stringify([credentials.botId,credentials.ownerId,id])).digest('hex'),contextToken:message.context_token};
}
export function reply(credentials,hit,challenge){return{msg:{from_user_id:'',to_user_id:credentials.ownerId,client_id:'yaoyao-w1-'+hit.key.slice(0,32),message_type:2,message_state:2,context_token:hit.contextToken,item_list:[{type:1,text_item:{text:'遥遥AI：微信文字通道测试成功（'+challenge+'）。下一步再接入我的对话和记忆。'}}]}};}
export async function deliverOnce(state,hit,credentials,challenge,save,send){
 if(state.delivery){if(state.delivery.key===hit.key&&['acknowledged','phone_confirmed'].includes(state.delivery.status))return false;throw Error('DELIVERY_ALREADY_ATTEMPTED');}
 state.delivery={key:hit.key,status:'attempted'};await save(state);
 const ack=await send(reply(credentials,hit,challenge));success(ack);
 const explicit=ack.ret===0||ack.errcode===0;state.delivery.status=explicit?'acknowledged':'sent_unconfirmed';await save(state);return explicit?true:'unconfirmed';
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function run(command,dir,client=new Client()){
 dir=resolve(dir);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 async function save(name,value){const p=resolve(dir,name);await writeFile(p+'.tmp',JSON.stringify(value),{mode:0o600});await chmod(p+'.tmp',0o600);await rename(p+'.tmp',p);}
 async function load(name,optional=false){try{const p=resolve(dir,name),s=await stat(p);if(s.mode&0o077)throw Error('PRIVATE_FILE_PERMISSIONS_REQUIRED');return JSON.parse(await readFile(p,'utf8'));}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
 async function status(phase,extra={}){const s={at:new Date().toISOString(),phase,rssMiB:Math.round(process.memoryUsage().rss/1048576),maxRssMiB:Math.round(process.resourceUsage().maxRSS/1024),...extra};await save('status.json',s);console.log(JSON.stringify(s));}
 if(command==='qr'){
  if(await load('credentials.json',true))throw Error('EXISTING_AUTHORIZATION_REQUIRES_REVIEW');
  const data=await client.request(BASE,'ilink/bot/get_bot_qrcode?bot_type=3',{body:{local_token_list:[]}});
  if(typeof data.qrcode!=='string'||!data.qrcode||typeof data.qrcode_img_content!=='string'||!data.qrcode_img_content)throw Error('QR_RESPONSE_INCOMPLETE');
  const u=new URL(data.qrcode_img_content);if(u.protocol!=='https:'||u.username||u.password||!(u.hostname==='weixin.qq.com'||u.hostname.endsWith('.weixin.qq.com')))throw Error('UNTRUSTED_QR_TARGET');
  const challenge='W1-'+randomBytes(3).toString('hex').toUpperCase();
  await save('pending.json',{qrcode:data.qrcode,url:data.qrcode_img_content,challenge,startedAt:Date.now(),base:BASE});
  // Only QR display data, never the login token. Download privately to render locally.
  await save('qr-display.json',{url:data.qrcode_img_content,challenge});await status('qr_ready',{challenge});return;
 }
 if(command==='login'){
  const pending=await load('pending.json');let last,redirects=0;
  while(Date.now()-pending.startedAt<300000){
   const code=await load('verify-code.json',true);let data;
   try{data=await client.request(pending.base,'ilink/bot/get_qrcode_status?qrcode='+encodeURIComponent(pending.qrcode)+(code?.code?'&verify_code='+encodeURIComponent(code.code):''));}catch(e){if(['API_REJECTED','AUTH_EXPIRED','HTTP_401','HTTP_403'].includes(e.message))throw e;await status('login_network_wait');await sleep(3000);continue;}
   if(!['wait','scaned','confirmed','expired','scaned_but_redirect','need_verifycode','verify_code_blocked','binded_redirect'].includes(data.status))throw Error('UNKNOWN_LOGIN_STATUS');
   if(code)await unlink(resolve(dir,'verify-code.json'));
   if(data.status!==last){await status('login_'+data.status);last=data.status;}
   if(data.status==='confirmed'){
    if(!data.bot_token||!data.ilink_bot_id||!data.ilink_user_id||!data.baseurl)throw Error('LOGIN_IDENTITY_INCOMPLETE');
    await save('credentials.json',{token:data.bot_token,botId:data.ilink_bot_id,ownerId:data.ilink_user_id,base:trustedBase(data.baseurl),challenge:pending.challenge,authorizedAt:new Date().toISOString()});await status('authorized',{challenge:pending.challenge});return;
   }
   if(data.status==='scaned_but_redirect'){if(++redirects>3)throw Error('TOO_MANY_REDIRECTS');pending.base=trustedBase('https://'+data.redirect_host);await save('pending.json',pending);continue;}
   if(['need_verifycode','verify_code_blocked','expired','binded_redirect'].includes(data.status))return;
   if(!['wait','scaned'].includes(data.status))throw Error('UNKNOWN_LOGIN_STATUS');await sleep(1500);
  }
  await status('qr_expired');return;
 }
 if(command==='listen'){
  const credentials=await load('credentials.json');const state=await load('delivery.json',true)||{cursor:''};
  if(['acknowledged','phone_confirmed'].includes(state.delivery?.status)){await status('already_completed');return;}
  if(state.delivery)throw Error('DELIVERY_ALREADY_ATTEMPTED');
  let startupNotify='unavailable';try{const n=await client.post(credentials.base,'ilink/bot/msg/notifystart',credentials.token,{});startupNotify=n.ret===0?'accepted':'unconfirmed';}catch(e){if(['AUTH_EXPIRED','HTTP_401','HTTP_403'].includes(e.message))throw e;}
  const deadline=Date.now()+600000;await status('waiting_for_test_message',{challenge:credentials.challenge,startupNotify});
  try{while(Date.now()<deadline){
   let data;try{data=await client.post(credentials.base,'ilink/bot/getupdates',credentials.token,{get_updates_buf:state.cursor});}catch(e){if(['API_REJECTED','AUTH_EXPIRED','HTTP_401','HTTP_403'].includes(e.message))throw e;await status('receive_network_wait');await sleep(3000);continue;}
   if(!Array.isArray(data.msgs))throw Error('INVALID_MESSAGE_BATCH');
   if(data.msgs.length)await status('received_batch',{messages:data.msgs.slice(0,5).map(m=>({messageType:m.message_type,state:m.message_state,fromMatches:m.from_user_id===credentials.ownerId,hasContext:typeof m.context_token==='string'&&!!m.context_token,group:!!m.group_id,deleted:!!m.delete_time_ms,idType:typeof m.message_id,idSafe:typeof m.message_id==='number'?Number.isSafeInteger(m.message_id):typeof m.message_id==='string',itemTypes:Array.isArray(m.item_list)?m.item_list.map(i=>i.type):[],textMatches:Array.isArray(m.item_list)?m.item_list.some(i=>typeof i.text_item?.text==='string'&&i.text_item.text.normalize('NFKC').trim().toUpperCase()===credentials.challenge):false}))});
   for(const m of data.msgs){const hit=inbound(m,credentials,credentials.challenge);if(!hit)continue;
    const delivered=await deliverOnce(state,hit,credentials,credentials.challenge,s=>save('delivery.json',s),body=>client.post(credentials.base,'ilink/bot/sendmessage',credentials.token,body));
    await status(delivered===true?'text_send_acknowledged':'text_send_unconfirmed',{receivedTestMessages:1,acknowledgedReplies:delivered===true?1:0});return;
   }
   if(typeof data.get_updates_buf==='string'&&data.get_updates_buf){state.cursor=data.get_updates_buf;await save('delivery.json',state);}await sleep(300);
  }
  await status('test_message_timeout');return;
  }finally{try{await client.post(credentials.base,'ilink/bot/msg/notifystop',credentials.token,{});}catch{/* Shutdown notification is best effort and contains no user content. */}}
 }
 throw Error('Use qr, login or listen');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 run(process.argv[2],process.env.W1_DIR||'/var/lib/yaoyao-weixin-w1').catch(async error=>{
  const code=/^(HTTP_\d{3}|[A-Z][A-Z_]+)$/.test(error.message)?error.message:'PROBE_FAILED';
  const entry={at:new Date().toISOString(),phase:'failed',code};
  try{const p=resolve(process.env.W1_DIR||'/var/lib/yaoyao-weixin-w1','status.json');await writeFile(p,JSON.stringify(entry),{mode:0o600});}catch{}
  console.error(JSON.stringify(entry));process.exitCode=1;
 });
}
