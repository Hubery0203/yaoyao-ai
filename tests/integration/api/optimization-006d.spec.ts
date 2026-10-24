import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {AIRouter} from '@yaoyao/runtime';
import {authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext} from './helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('006D production wiring and private performance',()=>{
 let ctx:ApiTestContext;
 beforeAll(async()=>{ctx=await setupApi();},120000);afterAll(async()=>{await ctx?.teardown();});
 it('reuses the same configured mock provider across tiers and fallback',()=>{const router=ctx.app.get<AIRouter>('YAOYAO_AI_ROUTER');const p=router.select({task:'conversation',fallbackAllowed:true}).provider;expect(router.select({task:'structured',fallbackAllowed:true}).provider).toBe(p);expect(router.fallbackProvider()).toBe(p);});
 it('records sanitized generation and replay without extra model invocations',async()=>{const me=await registerUser(ctx,'optimization006d@example.test');const recorder=ctx.app.get<{record(entry:unknown,source:string):void}>('CONVERSATION_PERFORMANCE');const spy=vi.spyOn(recorder,'record').mockImplementation(()=>{});const send=()=>ctx.http.post('/api/v1/conversations/messages').set(authHeader(me.accessToken)).set('Idempotency-Key','006d-replay').send({text:'我喜欢喝桂花乌龙茶。'});try{const first=await send(),replay=await send();expect(first.status).toBe(200);expect(replay.body.response).toBe(first.body.response);expect(spy).toHaveBeenCalledTimes(2);expect(spy.mock.calls[0][1]).toBe('web');expect(spy.mock.calls[0][0]).toMatchObject({version:'performance-v1',kind:'generation',completedInvocations:2});expect(spy.mock.calls[1][0]).toMatchObject({kind:'replay',completedInvocations:0});expect(JSON.stringify(spy.mock.calls)).not.toContain('桂花');expect(JSON.stringify(spy.mock.calls)).not.toContain(me.userId);const history=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(me.accessToken));expect(history.body.data.messages).toHaveLength(2);}finally{spy.mockRestore();}});
});
