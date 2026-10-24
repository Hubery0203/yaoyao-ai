import{afterAll,beforeAll,describe,it,expect,vi}from'vitest';
import{asProposal,type LLMProvider}from'@yaoyao/application';
import{AIRouter}from'@yaoyao/runtime';
import{authHeader,dockerAvailable,registerUser,setupApi,type ApiTestContext}from'./helpers.js';
const docker=await dockerAvailable();
describe.skipIf(!docker)('006EF production API pacing and replay',()=>{
 let ctx:ApiTestContext;
 beforeAll(async()=>{ctx=await setupApi();},120000);afterAll(async()=>{await ctx?.teardown();});
 it('repairs an unwanted question once, stores one pair, replays without new generation and isolates owners',async()=>{
  const me=await registerUser(ctx,'pacing006ef@example.test'),other=await registerUser(ctx,'other006ef@example.test');
  const provider=ctx.app.get<AIRouter>('YAOYAO_AI_ROUTER').select({task:'conversation',fallbackAllowed:true}).provider as LLMProvider;
  const original=provider.generate.bind(provider);let conversationCalls=0;
  const spy=vi.spyOn(provider,'generate').mockImplementation(async request=>{
   if(request.outputSchemaName!=='llm-output-contract-v1')return original(request);
   conversationCalls++;return{response:asProposal(conversationCalls===1?'你愿意说说吗？':'好，我陪你待会儿。'),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})};
  });
  try{
   const send=()=>ctx.http.post('/api/v1/conversations/messages').set(authHeader(me.accessToken)).set('Idempotency-Key','pacing006ef').send({text:'想安静待一会，不用追问。'});
   const first=await send();expect(first.status).toBe(200);expect(first.body.response).toBe('好，我陪你待会儿。');expect(conversationCalls).toBe(2);
   expect((await send()).body.response).toBe(first.body.response);expect(conversationCalls).toBe(2);
   const history=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(me.accessToken));expect(history.body.data.messages).toHaveLength(2);
   const isolated=await ctx.http.get('/api/v1/conversations/messages').set(authHeader(other.accessToken));expect(isolated.body.data.messages).toHaveLength(0);
  }finally{spy.mockRestore();}
 });
});
