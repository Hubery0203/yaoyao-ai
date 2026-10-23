import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('MVP-004 web contracts',()=>{
 let ctx:ApiTestContext;beforeAll(async()=>{ctx=await setupApi();},120000);afterAll(async()=>{await ctx?.teardown();});
 it('persists one retry-safe turn, restores history and isolates owners',async()=>{
 const me=await registerUser(ctx,'web004@example.com'),other=await registerUser(ctx,'other004@example.com');
 const send=(text:string)=>ctx.http.post('/api/v1/conversations/messages').set(authHeader(me.accessToken)).set('Idempotency-Key','web-retry-1').send({text});
 const first=await send('今天想聊聊');expect(first.status).toBe(200);expect((await send('今天想聊聊')).body.response).toBe(first.body.response);expect((await send('不同的内容')).status).toBe(409);
 const history=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(me.accessToken));expect(history.status).toBe(200);expect(history.body.data.messages).toHaveLength(2);expect(history.body.data.messages[0].text).toBe('今天想聊聊');
 const hidden=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(other.accessToken));expect(hidden.body.data.messages).toHaveLength(0);
 expect((await ctx.http.get('/api/v1/conversations/messages')).status).toBe(401);
 expect((await ctx.http.get('/api/v1/conversations/connection').set(authHeader(me.accessToken))).body.data).toEqual({provider:'mock',model:'mock'});
 expect((await ctx.http.get('/api/v1/conversations/messages?limit=-1').set(authHeader(me.accessToken))).status).toBe(400);
 });
});
