/** Bounded synthetic evaluation; default mock. --mode deepseek requires env key. */
import{readFile,writeFile}from'node:fs/promises';
import{ConversationOrchestrator,AIRouter,summarizeTurnQuality}from'../core/runtime/dist/index.js';
import{EmotionVector,extractExplicitMemories,decideMemory}from'../core/domain/dist/index.js';
import{asProposal}from'../core/application/dist/index.js';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const mode=arg('--mode')||'mock',output=arg('--out')||'quality-report.json';
if(!['mock','deepseek'].includes(mode))throw Error('Use --mode mock or --mode deepseek');
const fixtures=JSON.parse(await readFile(new URL('../tests/fixtures/conversation-quality.json',import.meta.url),'utf8'));
const report={at:new Date().toISOString(),mode,method:'Synthetic contexts, in-memory conversation events, no database writes, no emotion interpreter. Hints are lexical checks, not semantic quality scores.',turns:[]};
let adapter;
if(mode==='deepseek'){
 if(!process.env.DEEPSEEK_API_KEY)throw Error('DEEPSEEK_API_KEY must be supplied privately in the environment');
 const{DeepSeekAdapter}=await import('../core/infrastructure/dist/llm/deepseek.adapter.js');
 adapter=new DeepSeekAdapter({apiKey:process.env.DEEPSEEK_API_KEY,modelId:process.env.DEEPSEEK_MODEL||'deepseek-flash'});
}
for(const f of fixtures){
 const messages=[];let index=0,calls=0,forcedForTurn=false;
 const provider={providerId:adapter?.providerId||'mock',modelId:adapter?.modelId||'quality-fixture',capabilities:adapter?.capabilities||{supportsStructuredOutput:true,maxContextTokens:8000,costTier:1},generate:async request=>{
  calls++;if(adapter)return adapter.generate(request);
  const repeat=index===f.forceRepeatAt&&!forcedForTurn;
  if(repeat)forcedForTurn=true;
  const response=repeat?messages.filter(m=>m.role==='assistant').at(-1).text:f.replies[index];
  return{response:asProposal(response),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})};
 }};
 const events={
  findCompletedTurn:async x=>messages.find(m=>m.role==='assistant'&&m.requestId===x.requestId)?.text??null,
  persistUserMessage:async x=>{const duplicate=messages.some(m=>m.role==='user'&&m.requestId===x.requestId);if(!duplicate)messages.push({role:'user',text:x.text,requestId:x.requestId,occurredAt:new Date(),sequence:messages.length+1});return{eventId:'user-'+messages.length,duplicate};},
  persistAssistantMessage:async x=>{messages.push({role:'assistant',text:x.text,requestId:x.requestId,occurredAt:new Date(),sequence:messages.length+1});return{eventId:'assistant-'+messages.length,response:x.text};},
  loadHistory:async x=>messages.filter(m=>m.requestId!==x.excludeRequestId).slice(-x.limit),
 };
 const contextData={loadPersonaData:async userId=>({yaoyao:{yaoyaoId:'synthetic-companion',userId},relationship:{type:'deep_partner',status:'active',terminationAllowed:false,metrics:{intimacy:.8}},state:{emotion:EmotionVector.initial().with({affection:.85,hurt:0,anger:0}),energy:.7,socialState:'calm',relationshipState:'harmonious',attention:'present',stateVersion:1},recentEvents:[]})};
 const runtime=new ConversationOrchestrator({router:new AIRouter({l1:provider,l2:provider,l3:provider,fallback:provider}),contextData,conversationEvents:events});
 for(index=0;index<f.turns.length;index++){
  const input={userId:'synthetic-user',text:f.turns[index],traceId:f.id+'-'+index,requestId:f.id+'-'+index};const before=calls;forcedForTurn=false;
  try{
   const result=await runtime.converse(input),quality=summarizeTurnQuality(result.trace);const afterGeneration=calls;const replay=await runtime.converse(input);
   const candidates=extractExplicitMemories(input.text).map(c=>({slot:c.slot,value:c.value,kind:c.kind,outcome:decideMemory({candidate:c,source:input.text,inputs:{importance:c.importance,relevance:c.relevance,confidence:c.confidence,novelty:1,recurrence:0},existingExact:false}).outcome}));
   report.turns.push({session:f.id,index,input:input.text,response:result.response,quality,modelCalls:calls-before,idempotentReplay:replay.response===result.response&&calls===afterGeneration,candidates,...(index===f.turns.length-1&&f.hint?{lexicalHint:new RegExp(f.hint,'iu').test(result.response)}:{})});
  }catch(e){report.turns.push({session:f.id,index,error:e.name,code:typeof e.code==='string'?e.code:'UNAVAILABLE'});}
 }
}
report.summary={turns:report.turns.length,errors:report.turns.filter(t=>t.error).length,providerFallbacks:report.turns.filter(t=>t.quality?.providerFallback).length,validationFallbacks:report.turns.filter(t=>t.quality?.validationFallback).length,repairs:report.turns.reduce((n,t)=>n+(t.quality?.repairAttempts||0),0),replayFailures:report.turns.filter(t=>!t.error&&!t.idempotentReplay).length,failedLexicalHints:report.turns.filter(t=>t.lexicalHint===false).length,unexplainedRepairs:report.turns.filter(t=>t.quality?.repairAttempts&&!t.quality.failures.length).length,unexplainedFallbacks:report.turns.filter(t=>t.quality?.validationFallback&&!t.quality.failures.length).length};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode,...report.summary,output}));if(report.summary.errors||report.summary.replayFailures||report.summary.unexplainedRepairs||report.summary.unexplainedFallbacks)process.exitCode=1;

if(mode==='mock'&&(report.summary.repairs!==fixtures.filter(f=>Number.isInteger(f.forceRepeatAt)).length||report.summary.validationFallbacks||report.summary.failedLexicalHints))process.exitCode=1;
