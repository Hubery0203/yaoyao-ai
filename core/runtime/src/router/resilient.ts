/** Runtime owns retry count and total invocation time; provider SDK retries are off. */
import {ProviderError,type LLMProposal,type LLMProvider,type LLMRequest,type ProviderCallTelemetry,type SuccessfulProviderUsage} from '@yaoyao/application';
export interface ResilienceConfig {
 readonly maxRetries?:number;
 readonly baseBackoffMs?:number;
 readonly maxBackoffMs?:number;
}
export interface ResilientResult {readonly proposal:LLMProposal;readonly telemetry:ProviderCallTelemetry}
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export class ResilientLLMInvoker {
 private readonly maxRetries:number;private readonly baseBackoffMs:number;private readonly maxBackoffMs:number;
 constructor(private readonly primary:LLMProvider,private readonly fallback:LLMProvider,config:ResilienceConfig={}){
  this.maxRetries=config.maxRetries??1;this.baseBackoffMs=config.baseBackoffMs??500;this.maxBackoffMs=config.maxBackoffMs??5000;
 }
 async invoke(request:LLMRequest):Promise<ResilientResult>{
  const started=Date.now(),deadline=started+request.timeoutMs;let retryCount=0,attempts=0,lastError:ProviderError|undefined;
  const timeout=()=>new ProviderError({code:'TIMEOUT',providerId:this.primary.providerId,message:'invocation time budget exhausted',retryable:true});
  const generate=async(provider:LLMProvider,fallbackUsed:boolean):Promise<ResilientResult>=>{
   const remaining=deadline-Date.now();if(remaining<=0)throw timeout();attempts++;
   const proposal=await provider.generate({...request,timeoutMs:Math.min(request.timeoutMs,remaining)});
   let successfulUsage:SuccessfulProviderUsage|undefined;
   // Optional telemetry must not fail an otherwise valid generation.
   try{const u=provider.usageFor?.(proposal);if(u&&Number.isSafeInteger(u.inputTokens)&&u.inputTokens>=0&&Number.isSafeInteger(u.outputTokens)&&u.outputTokens>=0)successfulUsage={inputTokens:u.inputTokens,outputTokens:u.outputTokens};}catch{/* telemetry only */}
   return {proposal,telemetry:{requestId:request.metadata.requestId,providerId:provider.providerId,modelId:provider.modelId,latencyMs:Date.now()-started,retryCount,fallbackUsed,validationResult:'not-run',attempts,successfulUsage}};
  };
  for(let attempt=0;attempt<=this.maxRetries;attempt++){
   try{return await generate(this.primary,false);}catch(error){
    lastError=error instanceof ProviderError?error:undefined;
    if(!lastError?.retryable||attempt>=this.maxRetries)break;
    const hint=lastError.retryAfterMs;
    // Never shorten a server's valid Retry-After. Defer instead of hammering.
    if(hint!==undefined&&Number.isFinite(hint)&&hint>this.maxBackoffMs)break;
    const backoff=hint!==undefined&&Number.isFinite(hint)&&hint>=0?hint:Math.min(this.baseBackoffMs*2**attempt,this.maxBackoffMs);
    if(backoff>=deadline-Date.now())break;
    retryCount++;await sleep(backoff);
   }
  }
  // A reused provider is not failover. Do not add a third identical call.
  if(this.primary===this.fallback)throw lastError??new ProviderError({code:'UNKNOWN',providerId:this.primary.providerId,message:'primary produced no proposal',retryable:false});
  if(Date.now()>=deadline)throw lastError??timeout();
  try{return await generate(this.fallback,true);}catch(error){
   const reason=error instanceof ProviderError?error.code:'unknown';
   throw new ProviderError({code:'UNKNOWN',providerId:this.primary.providerId,message:`primary failed (${lastError?.code??'unknown'}) and fallback failed (${reason}); no proposal produced`,retryable:false});
  }
 }
}
