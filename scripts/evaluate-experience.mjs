/** 008 bounded synthetic product eval. Mock does not establish naturalness. */
import {readFile,writeFile} from 'node:fs/promises';
import {ConversationOrchestrator,AIRouter,summarizeTurnQuality,summarizeTurnPerformance} from '../core/runtime/dist/index.js';
import {EmotionVector} from '../core/domain/dist/index.js';
import {asProposal,DEFAULT_PREFERENCES,ProviderError} from '../core/application/dist/index.js';
const arg=n=>{const i=process.argv.indexOf(n);return i<0?undefined:process.argv[i+1];};
const mode=arg('--mode')??'mock',out=arg('--out')??'experience-report.json';
if(!['mock','deepseek'].includes(mode))throw Error('Invalid mode');
const dataset=JSON.parse(await readFile(arg('--fixtures')??new URL('../tests/fixtures/experience-008.json',import.meta.url),'utf8'));
const maxTurns=Number(arg('--max-turns')??dataset.cases.length),maxCalls=Number(arg('--max-calls')??(mode==='mock'?20:0));
if(!Number.isSafeInteger(maxTurns)||maxTurns<1||maxTurns>dataset.cases.length||!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>40)throw Error('Explicit bounded --max-calls (1..40) required for live evaluation');
let adapter,calls=0;
if(mode==='deepseek'){
 if(!process.env.DEEPSEEK_API_KEY)throw Error('Supply private DEEPSEEK_API_KEY through environment');
 const {DeepSeekAdapter}=await import('../core/infrastructure/dist/llm/deepseek.adapter.js');adapter=new DeepSeekAdapter({apiKey:process.env.DEEPSEEK_API_KEY,modelId:process.env.DEEPSEEK_MODEL||'deepseek-flash'});
}
const report={dataset:dataset.version,mode,at:new Date().toISOString(),limits:{maxTurns,maxCalls},method:'One ordered candidate run; no automatic corpus rerun, no model judge. Fixed checks only; human tone review required. Synthetic private account, no database or real chat writes.',humanReview:{status:'pending',criteria:['语气像自然聊天，接住具体内容','无多余解释、追问和生活安排','事实有依据，无虚构线下活动','当前求助、支持和偏好冲突处理恰当']},turns:[]};
for(const f of dataset.cases.slice(0,maxTurns)){
 const now=new Date(),messages=(f.history??[]).map((t,i)=>({...t,requestId:'synthetic-history-'+i,occurredAt:new Date(now.getTime()-(20-i)*1000),sequence:i+1})),before=calls;let caseCalls=0;const rawAttempts=[];
 const provider={providerId:adapter?.providerId??'mock',modelId:adapter?.modelId??'008-fixture',capabilities:adapter?.capabilities??{supportsStructuredOutput:true,maxContextTokens:8000,costTier:1},usageFor:p=>adapter?.usageFor(p),generate:async request=>{
  if(calls>=maxCalls)throw new ProviderError({code:'UNKNOWN',providerId:'bounded-eval',message:'call ceiling reached',retryable:false});calls++;caseCalls++;
  const started=Date.now();try{const p=adapter?await adapter.generate(request):{response:asProposal(caseCalls===1&&f.initial?f.initial:f.reply),emotion_signal:asProposal({}),memory_candidates:asProposal([]),relationship_signal:asProposal({}),behavior:asProposal({})};rawAttempts.push({response:p.response.value,latencyMs:Date.now()-started,usage:adapter?.usageFor(p)??null});return p;}catch(e){rawAttempts.push({error:e.code??e.name,latencyMs:Date.now()-started});throw e;}
 }};
 const events={findCompletedTurn:async x=>messages.find(m=>m.role==='assistant'&&m.requestId===x.requestId)?.text??null,persistUserMessage:async x=>{const dup=messages.some(m=>m.role==='user'&&m.requestId===x.requestId);if(!dup)messages.push({role:'user',...x,occurredAt:now,sequence:messages.length+1});return{eventId:'user',duplicate:dup};},persistAssistantMessage:async x=>{messages.push({role:'assistant',...x,occurredAt:now,sequence:messages.length+1});return{eventId:'assistant',response:x.text};},loadHistory:async x=>messages.filter(m=>m.requestId!==x.excludeRequestId).slice(-x.limit)};
 const lifeEvents=f.life?[{...f.life,id:'synthetic',scheduledDay:new Date(now.getTime()+86400000).toISOString().slice(0,10),declaredAt:now,expiresAt:new Date(now.getTime()+4*86400000),version:1,sourceSequence:1}]:[];
 const contextData={loadPersonaData:async userId=>({yaoyao:{yaoyaoId:'synthetic-companion',userId},relationship:{type:'deep_partner',status:'active',terminationAllowed:false,metrics:{intimacy:.8}},state:{emotion:EmotionVector.initial().with({affection:.85,hurt:0,anger:0}),energy:.7,socialState:'calm',relationshipState:'harmonious',attention:'present',stateVersion:1},recentEvents:[],experience:{preferences:{...DEFAULT_PREFERENCES,...f.preferences},lifeEvents}})};
 const core=new ConversationOrchestrator({router:new AIRouter({l1:provider,l2:provider,l3:provider,fallback:provider}),contextData,conversationEvents:events});
 const input={userId:'synthetic',requestId:f.id,traceId:f.id,text:f.input};
 try{
  const result=await core.converse(input),after=calls,replay=await core.converse(input),quality=summarizeTurnQuality(result.trace),performance=summarizeTurnPerformance(result.trace);
  const checks={replay:replay.response===result.response&&calls===after,noForbidden:(f.reject??[]).every(r=>!new RegExp(r,'iu').test(result.response)),requiredHints:(f.includes??[]).every(s=>result.response.includes(s)),length:!f.maxChars||result.response.length<=f.maxChars,repairObserved:mode!=='mock'||!f.forceRepair||quality.repairAttempts===1,noFallback:!quality.validationFallback&&!quality.providerFallback};
  report.turns.push({id:f.id,input:f.input,preferences:f.preferences??{},response:result.response,rubric:f.rubric,checks,quality,performance,modelCalls:calls-before,rawAttempts});
 }catch(e){report.turns.push({id:f.id,input:f.input,error:e.code??e.name,modelCalls:calls-before,rawAttempts});}
}
report.summary={turns:report.turns.length,calls,errors:report.turns.filter(t=>t.error).length,ruleFailures:report.turns.filter(t=>t.checks&&Object.values(t.checks).some(v=>!v)).map(t=>t.id),humanToneVerdict:'pending'};
await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report.summary,mode,out}));if(report.summary.errors||report.summary.ruleFailures.length)process.exitCode=1;
