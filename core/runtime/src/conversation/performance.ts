/** Numeric allowlist only. Successful-response usage is not a billing total. */
export function summarizeTurnPerformance(input:unknown){
 const obj=(value:unknown)=>(value&&typeof value==='object'?value:{}) as Record<string,unknown>;
 const trace=obj(input),p=obj(trace.performance),creation=obj(trace.eventCreation);
 const bounded=(value:unknown,max=1000000000)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(0,Math.round(value))):0;
 const time=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;
 const start=time(trace.startedAt),end=time(trace.finishedAt);
 return {version:'performance-v1',kind:creation.status==='idempotent-replay'?'replay':'generation',
  totalMs:Number.isFinite(start)&&Number.isFinite(end)?bounded(end-start):0,
  contextMs:bounded(p.contextMs),emotionMs:bounded(p.emotionMs),
  completedInvocations:bounded(p.completedInvocations,10),failedInvocations:bounded(p.failedInvocations,10),
  knownProviderAttempts:bounded(p.knownProviderAttempts,30),usageSamples:bounded(p.usageSamples,10),
  successfulInputTokens:bounded(p.successfulInputTokens),successfulOutputTokens:bounded(p.successfulOutputTokens),
  estimatedContextTokens:bounded(p.estimatedContextTokens),historyIncluded:bounded(p.historyIncluded,20),historyDropped:bounded(p.historyDropped,20),historyNewestTruncated:p.historyNewestTruncated===true,emotionBudgetSkipped:p.emotionBudgetSkipped===true};
}
