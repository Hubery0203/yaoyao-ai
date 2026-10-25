/** Bounded numeric counters only, no history/IDs/user text and no background timer. */
const fields=['contextMs','emotionMs','knownProviderAttempts','completedInvocations','failedInvocations','usageSamples','successfulInputTokens','successfulOutputTokens']as const;
const bounds=[100,250,500,1000,2000,5000,10000,20000,45000,90000,180000];
const numeric=(v:unknown,max=1e9)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(0,Math.round(v))):0;
export class RollingPerformance {
 private since:number;private records=0;private generation=0;private replay=0;private totalMs=0;private lastLog:number;private sources={web:0,weixin:0};private buckets=Array(bounds.length+1).fill(0)as number[];private totals=Object.fromEntries(fields.map(k=>[k,0]))as Record<typeof fields[number],number>;
 constructor(private readonly every=10,private readonly windowMs=900000,private readonly clock=Date.now){if(!Number.isInteger(every)||every<1||every>100||!Number.isInteger(windowMs)||windowMs<1000||windowMs>3600000)throw Error('INVALID_METRIC_WINDOW');this.since=this.lastLog=clock();}
 record(input:unknown,source:'web'|'weixin'){
  if(source!=='web'&&source!=='weixin')return null;const now=this.clock();if(now<this.since||now-this.since>=this.windowMs)this.reset(now);
  const p=input&&typeof input==='object'?input as Record<string,unknown>:{};if(!['generation','replay'].includes(String(p.kind)))return null;
  this.records++;this.sources[source]++;
  if(p.kind==='replay')this.replay++;else {this.generation++;const ms=numeric(p.totalMs,180000);this.totalMs+=ms;const i=bounds.findIndex(b=>ms<=b);this.buckets[i<0?bounds.length:i]++;for(const f of fields)this.totals[f]=Math.min(1e12,this.totals[f]+numeric(p[f]));}
  if(this.records%this.every!==0&&now-this.lastLog<60000&&!numeric(p.failedInvocations,10))return null;
  this.lastLog=now;return this.snapshot();
 }
 snapshot(){let count=0,p95UpperMs=0;for(let i=0;i<this.buckets.length;i++){count+=this.buckets[i];if(this.generation&&count>=Math.ceil(this.generation*.95)){p95UpperMs=bounds[i]??180000;break;}}
  return {version:'performance-window-v1',windowStartedAtUTC:new Date(this.since).toISOString(),windowElapsedMs:Math.max(0,this.clock()-this.since),generation:this.generation,replay:this.replay,sources:{...this.sources},meanGenerationMs:this.generation?Math.round(this.totalMs/this.generation):0,p95UpperMs,...this.totals,usageCoverageNote:'successful_responses_only_not_billing_total',resetOnProcessRestart:true};
 }
 private reset(now:number){this.since=this.lastLog=now;this.records=this.generation=this.replay=this.totalMs=0;this.sources={web:0,weixin:0};this.buckets.fill(0);for(const f of fields)this.totals[f]=0;}
}
