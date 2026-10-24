import{test}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,readFile,stat,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{Client,BASE,trustedBase,inbound,reply,success,deliverOnce,run}from'./probe.mjs';
const c={ownerId:'synthetic-scanner',botId:'synthetic-bot',token:'private-token'},challenge='W1-ABC123';
const m={message_type:1,message_state:2,message_id:42,from_user_id:c.ownerId,context_token:'private-context',item_list:[{type:1,text_item:{text:challenge}}]};
test('limits authentication to trusted HTTPS origins',()=>{assert.equal(trustedBase(BASE),BASE);for(const u of ['http://ilinkai.weixin.qq.com','https://weixin.qq.com.evil.test','https://u:p@ilinkai.weixin.qq.com','https://ilinkai.weixin.qq.com:444','https://127.0.0.1','https://ilinkai.weixin.qq.com/else'])assert.throws(()=>trustedBase(u));});
test('only exact scanner, one text item, correct challenge and usable context qualify',()=>{
 assert.ok(inbound(m,c,challenge));for(const change of [{from_user_id:'other'},{group_id:'group'},{message_type:2},{message_state:1},{context_token:''},{delete_time_ms:1},{message_id:Number.MAX_SAFE_INTEGER+1},{item_list:[{type:2}]},{item_list:[...m.item_list,...m.item_list]},{item_list:[{type:1,text_item:{text:'hello'}}]}])assert.equal(inbound({...m,...change},c,challenge),null);
});
test('does not put auth token in reply; uses stable client ID and exact context',()=>{const h=inbound(m,c,challenge),b=reply(c,h,challenge);assert.equal(b.msg.to_user_id,c.ownerId);assert.equal(b.msg.context_token,m.context_token);assert.equal(b.msg.client_id,reply(c,inbound(m,c,challenge),challenge).msg.client_id);assert.ok(b.msg.item_list[0].text_item.text.includes('遥遥AI'));assert.ok(!JSON.stringify(b).includes(c.token));});
test('requires explicit send acknowledgement and stops on expired authorization',()=>{assert.throws(()=>success({ret:-14}),/AUTH_EXPIRED/);assert.throws(()=>success({ret:1}),/API_REJECTED/);assert.throws(()=>success({},true),/ACK_UNCERTAIN/);assert.equal(success({ret:0},true).ret,0);});
test('journals attempt before sending and prevents duplicate reply',async()=>{const state={},order=[],hit=inbound(m,c,challenge);let sends=0;const save=async s=>order.push(s.delivery.status),send=async()=>{sends++;assert.equal(order[0],'attempted');return{ret:0};};assert.equal(await deliverOnce(state,hit,c,challenge,save,send),true);assert.equal(await deliverOnce(state,hit,c,challenge,save,send),false);assert.equal(sends,1);assert.deepEqual(order,['attempted','acknowledged']);});
test('ambiguous failed send is not automatically retried',async()=>{const state={},hit=inbound(m,c,challenge);let sends=0;const send=async()=>{sends++;throw Error('NETWORK');};await assert.rejects(deliverOnce(state,hit,c,challenge,async()=>{},send));await assert.rejects(deliverOnce(state,hit,c,challenge,async()=>{},send),/DELIVERY_ALREADY_ATTEMPTED/);assert.equal(sends,1);});
test('constructs correct app headers, POST auth and GET without bearer',async()=>{
 const seen=[];const api=new Client(async(url,options)=>{seen.push({url,...options});return new Response('{"ret":0}');});await api.request(BASE,'ilink/bot/get_qrcode_status?qrcode=synthetic');await api.post(BASE,'ilink/bot/sendmessage',c.token,{msg:{}});assert.equal(seen[0].method,'GET');assert.equal(seen[0].headers.Authorization,undefined);assert.equal(seen[0].headers['X-WECHAT-UIN'],undefined);assert.equal(seen[1].headers.Authorization,'Bearer '+c.token);assert.equal(seen[1].headers['iLink-App-Id'],'bot');assert.equal(seen[1].redirect,'error');assert.equal(JSON.parse(seen[1].body).base_info.bot_agent,'YaoYaoW1/0.1');
});
test('rejects failed HTTP, malformed or oversized response without logging body',async()=>{for(const response of [new Response('secret',{status:403}),new Response('not-json'),new Response('x'.repeat(524289))]){const api=new Client(async()=>response);await assert.rejects(api.request(BASE,'test'),e=>!e.message.includes('secret'));}});
test('QR and credentials remain private; console never reveals credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yaoyao-w1-'));const old=console.log,logs=[];console.log=s=>logs.push(s);
 try{const api={request:async(base,path)=>path.includes('get_bot_qrcode')?{qrcode:'secret-qr',qrcode_img_content:'https://liteapp.weixin.qq.com/q/synthetic'}:{status:'confirmed',bot_token:c.token,ilink_bot_id:c.botId,ilink_user_id:c.ownerId,baseurl:BASE}};await run('qr',dir,api);await run('login',dir,api);const cred=JSON.parse(await readFile(join(dir,'credentials.json'),'utf8'));assert.equal(cred.token,c.token);assert.equal((await stat(join(dir,'credentials.json'))).mode&0o077,0);assert.ok(!logs.join().includes(c.token));assert.ok(!logs.join().includes(c.ownerId));await assert.rejects(run('qr',dir,api),/EXISTING_AUTHORIZATION/);
 }finally{console.log=old;await rm(dir,{recursive:true,force:true});}
});
test('single reply is bracketed by official lifecycle notifications',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'yaoyao-w1-lifecycle-'));const old=console.log;console.log=()=>{};
 try{const api={request:async(base,path)=>path.includes('get_bot_qrcode')?{qrcode:'synthetic',qrcode_img_content:'https://liteapp.weixin.qq.com/q/synthetic'}:{status:'confirmed',bot_token:c.token,ilink_bot_id:c.botId,ilink_user_id:c.ownerId,baseurl:BASE}};await run('qr',dir,api);await run('login',dir,api);const cred=JSON.parse(await readFile(join(dir,'credentials.json'),'utf8'));const calls=[];
  api.post=async(base,path)=>{calls.push(path);return path.endsWith('getupdates')?{ret:0,msgs:[{...m,item_list:[{type:1,text_item:{text:cred.challenge.toLowerCase()}}]}]}:{ret:0};};await run('listen',dir,api);
  assert.deepEqual(calls,['ilink/bot/msg/notifystart','ilink/bot/getupdates','ilink/bot/sendmessage','ilink/bot/msg/notifystop']);assert.equal(JSON.parse(await readFile(join(dir,'status.json'),'utf8')).phase,'text_send_acknowledged');
 }finally{console.log=old;await rm(dir,{recursive:true,force:true});}
});

test('preserves actual 64-bit numeric Weixin IDs without rounding',async()=>{
 const api=new Client(async()=>new Response('{"ret":0,"msgs":[{"message_id":18446744073709551615}]}'));const data=await api.request(BASE,'synthetic');assert.equal(data.msgs[0].message_id,'18446744073709551615');assert.ok(inbound({...m,message_id:data.msgs[0].message_id},c,challenge));
});

test('missing send success fields stays unconfirmed and never triggers automatic resend',async()=>{
 const state={},hit=inbound(m,c,challenge);let calls=0;const save=async()=>{},send=async()=>{calls++;return{};};assert.equal(await deliverOnce(state,hit,c,challenge,save,send),'unconfirmed');assert.equal(state.delivery.status,'sent_unconfirmed');await assert.rejects(deliverOnce(state,hit,c,challenge,save,send),/DELIVERY_ALREADY_ATTEMPTED/);assert.equal(calls,1);state.delivery.status='phone_confirmed';assert.equal(await deliverOnce(state,hit,c,challenge,save,send),false);
});
