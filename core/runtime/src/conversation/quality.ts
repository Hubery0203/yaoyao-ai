/** Allowlisted attempt telemetry: never user text, responses, IDs, keys or raw reasons. */
const STAGES=['schema','identity','relationship','behavior','continuity','safety','core-proposal'] as const;
export function validationFailureSummary(failure:{stage:string;reason:string}):{stage:string;code:string} {
 const stage=(STAGES as readonly string[]).includes(failure.stage)?failure.stage:'schema';
 const code=stage==='continuity'?(failure.reason.includes('burst echo')?'burst_echo':failure.reason.includes('revoked suggestion')?'revoked_suggestion':failure.reason.includes('accountability taunt')?'accountability_taunt':failure.reason.includes('mechanical emotion')?'mechanical_commentary':failure.reason.includes('service explanation tail')?'service_tail':failure.reason.includes('repeated opening')?'repeated_opening':failure.reason.startsWith('experience:')?'account_experience':failure.reason.includes('service-style preamble')?'service_preamble':failure.reason.includes('farewell extended')?'farewell_extended':failure.reason.includes('invented offline activity')?'offline_invention':failure.reason.includes('unsupported plan outcome')?'plan_evidence':failure.reason.includes('unwanted question')?'unwanted_question':failure.reason.includes('brevity ignored')?'explicit_brevity':failure.reason.includes('abandoned topic hook')?'abandoned_topic':failure.reason.includes('contradicted latest user fact')?'latest_fact_conflict':failure.reason.includes('premature memory receipt')?'premature_memory_receipt':failure.reason.includes('statement motive probe')?'repeated_statement_motive':failure.reason.includes('elapsed recall time')?'elapsed_recall_time':failure.reason.includes('answered question')?'answered_question':failure.reason.includes('previous assistant')?'previous_response':failure.reason.includes('echo')?'user_echo':'repetition'):stage;
 return {stage,code};
}
export function summarizeTurnQuality(input:unknown) {
 const trace=(input&&typeof input==='object'?input:{})as Record<string,unknown>;
 const obj=(v:unknown)=>(v&&typeof v==='object'?v:{})as Record<string,unknown>;
 const v=obj(trace.validation),llm=obj(trace.llm),creation=obj(trace.eventCreation);
 const replay=creation.status==='idempotent-replay';
 const codes=['schema','identity','relationship','behavior','safety','core-proposal','answered_question','previous_response','user_echo','repetition','elapsed_recall_time','repeated_statement_motive','premature_memory_receipt','unwanted_question','explicit_brevity','abandoned_topic','latest_fact_conflict','plan_evidence','offline_invention','service_preamble','farewell_extended','account_experience','burst_echo','revoked_suggestion','accountability_taunt','mechanical_commentary','service_tail','repeated_opening'];
 const failures=(Array.isArray(v.failures)?v.failures:[]).slice(0,2).map(x=>{const f=obj(x);return {stage:(STAGES as readonly unknown[]).includes(f.stage)?String(f.stage):'schema',code:codes.includes(String(f.code))?String(f.code):'schema'};});
 return {...(v.groundedRecordReply===true?{groundedRecordReply:true}:{}),version:'quality-v1',kind:replay?'replay':'generation',providerFallback:llm.fallbackUsed===true||v.providerFallbackUsed===true,
  validationFallback:v.fallbackUsed===true,repairAttempts:typeof v.repairAttempts==='number'&&Number.isInteger(v.repairAttempts)?Math.min(1,Math.max(0,v.repairAttempts)):0,failures};
}
