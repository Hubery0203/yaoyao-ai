import {describe,it,expect,vi} from 'vitest';
import {extractText,parseWeixin,trustedWeixinBase,WeixinClient,WeixinError,type WeixinRow} from '@yaoyao/infrastructure';
import {processWeixinMessage} from '../../apps/api/src/weixin-bridge.service.js';
const credentials={base:'https://ilinkai.weixin.qq.com',token:'test-only',botId:'bot-test',ownerId:'peer-test'};
const input={message_id:'9223372036854775807',message_type:1,message_state:2,from_user_id:'peer-test',context_token:'private-context',create_time_ms:Date.now(),item_list:[{type:1,text_item:{text:'今天过得怎么样？'}}]};
const row=(extra:Partial<WeixinRow>={}):WeixinRow=>({message_key:'a'.repeat(64),user_id:'user-test',text:'hello',context_token:'private-context',reply:null,stage:'pending',attempts:0,retry_at:new Date(0),...extra});
describe('W2/W3 protocol and crash-safe processor',()=>{
 it('preserves exact uint64 message IDs',()=>{expect(parseWeixin('{"message_id":9223372036854775807}').message_id).toBe('9223372036854775807');});
 it('allows missing success code but rejects explicit errors',()=>{expect(parseWeixin('{}')).toEqual({});expect(()=>parseWeixin('{"ret":-14}')).toThrow('AUTH_EXPIRED');expect(()=>parseWeixin('{"errcode":1}')).toThrow('API_REJECTED');});
 it.each(['http://weixin.qq.com','https://evil.test','https://weixin.qq.com.evil.test','https://x@weixin.qq.com','https://weixin.qq.com/path','https://weixin.qq.com:8443'])('rejects credential destinations %s',url=>{expect(()=>trustedWeixinBase(url)).toThrow();});
 it('accepts only scanner complete single text with valid time and exact id',()=>{
  const hit=extractText(input,credentials)!;expect(hit.text).toBe('今天过得怎么样？');expect(hit.key).toMatch(/^[a-f0-9]{64}$/);
  for(const extra of [{from_user_id:'other'},{group_id:'group'},{delete_time_ms:1},{message_state:1},{create_time_ms:undefined},{message_id:9223372036854776000},{item_list:[{type:2}]}])expect(extractText({...input,...extra},credentials)).toBeNull();
 });
 it('sends to scanner with stable client id and refuses redirects',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));const client=new WeixinClient(credentials,fetcher);
  await client.send('key','context','reply');const [url,options]=fetcher.mock.calls[0];expect(url).toContain('/ilink/bot/sendmessage');expect(options.redirect).toBe('error');const body=JSON.parse(options.body);expect(body.msg.to_user_id).toBe(credentials.ownerId);expect(body.msg.client_id).toBe('yaoyao-key');expect(body.msg.context_token).toBe('context');
 });
 it('persists generation and outbox before external send; HTTP acceptance is not receipt',async()=>{
  const events:string[]=[];const store={update:vi.fn(async(_key,stage)=>{events.push(stage);})};const send=vi.fn(async()=>{events.push('network');return {};});const converse=vi.fn(async()=>{events.push('model');return 'reply';});
  await processWeixinMessage(row(),store,{send},converse);expect(events).toEqual(['generating','model','ready','sending','network','accepted']);expect(store.update.mock.calls.at(-1)?.[2]).toEqual({ack:'http_accepted'});expect(converse.mock.calls[0][2]).toBe('weixin-'+'a'.repeat(64));
 });
 it('never regenerates persisted reply',async()=>{const converse=vi.fn();const send=vi.fn().mockResolvedValue({ret:0});const update=vi.fn();await processWeixinMessage(row({reply:'saved',stage:'ready'}),{update},{send},converse);expect(converse).not.toHaveBeenCalled();expect(send.mock.calls[0][2]).toBe('saved');expect(update.mock.calls.at(-1)?.[2]).toEqual({ack:'api_accepted'});});
 it.each(['uncertain','failed'])('does not automatically redeliver %s',async stage=>{const send=vi.fn(),converse=vi.fn(),update=vi.fn();await processWeixinMessage(row({stage}),{update},{send},converse);expect(send).not.toHaveBeenCalled();expect(update).not.toHaveBeenCalled();});
 it('marks timeout uncertain and does not claim delivery',async()=>{const update=vi.fn(),send=vi.fn().mockRejectedValue(Error('timeout'));await processWeixinMessage(row({reply:'saved',stage:'ready'}),{update},{send},vi.fn());expect(update.mock.calls.at(-1)?.[1]).toBe('uncertain');});
 it('does not send when durable sending mark failed',async()=>{const send=vi.fn(),update=vi.fn().mockRejectedValue(Error('DB unavailable'));await expect(processWeixinMessage(row({reply:'saved',stage:'ready'}),{update},{send},vi.fn())).rejects.toThrow();expect(send).not.toHaveBeenCalled();});
 it('bounded generation retry keeps original request identity',async()=>{const update=vi.fn(),send=vi.fn();await processWeixinMessage(row({attempts:2}),{update},{send},vi.fn().mockRejectedValue(Error('provider')));expect(update.mock.calls.at(-1)?.[1]).toBe('failed');expect(send).not.toHaveBeenCalled();});
 it('explicit rate rejection retries with backoff',async()=>{const update=vi.fn();await processWeixinMessage(row({reply:'saved',stage:'ready'}),{update},{send:vi.fn().mockRejectedValue(new WeixinError('RATE_LIMITED'))},vi.fn());expect(update.mock.calls.at(-1)?.[1]).toBe('ready');expect(update.mock.calls.at(-1)?.[2].delay).toBeGreaterThan(0);});
 it('auth rejection propagates so receiver pauses',async()=>{const update=vi.fn();await expect(processWeixinMessage(row({reply:'saved',stage:'ready'}),{update},{send:vi.fn().mockRejectedValue(new WeixinError('AUTH_EXPIRED'))},vi.fn())).rejects.toThrow('AUTH_EXPIRED');expect(update.mock.calls.at(-1)?.[2].error).toBe('AUTH_EXPIRED');});
});
