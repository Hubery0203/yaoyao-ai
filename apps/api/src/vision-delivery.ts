import {INCOMING_IMAGE_TEXT,VISION_DISABLED,VISION_FAILURE,VISION_LIMIT,VISION_UNSUPPORTED} from '@yaoyao/application';
import {MiniMaxVisionProvider,WeixinVisionStore,downloadWeixinImage,VisionError,type AppConfig,type WeixinStore,type WeixinRow,type VisionContext} from '@yaoyao/infrastructure';
export interface VisionDependencies {
 jobs:Pick<WeixinVisionStore,'get'|'reserve'|'save'|'discardMedia'>;
 download:()=>Promise<Buffer>;
 context:()=>Promise<readonly VisionContext[]>;
 validate:(bytes:Buffer,caption:string,context:readonly VisionContext[])=>void;
 understand:(bytes:Buffer,caption:string,context:readonly VisionContext[])=>Promise<string>;
 limit:number;activeSinceMs:number;
}
export function visionConfigured(config:AppConfig):boolean {
 return config.VISION_ENABLED==='1'&&!!config.MINIMAX_VISION_API_KEY?.trim()&&!!config.MINIMAX_VISION_REGION&&!!config.VISION_ACTIVE_SINCE&&Number.isFinite(Date.parse(config.VISION_ACTIVE_SINCE))&&Date.parse(config.VISION_ACTIVE_SINCE)<=Date.now();
}
export async function prepareWeixinVision(row:WeixinRow,jobs:VisionDependencies['jobs'],deps?:VisionDependencies):Promise<string>{
 // Recovery is resolved before reading credentials or downloading: a durable reservation can never authorize a second paid attempt.
 const prior=await jobs.get(row);
 if(prior?.response)return prior.response;
 if(prior){await jobs.save(row,'failed',VISION_FAILURE,'VISION_RESULT_UNKNOWN');return VISION_FAILURE;}
 if(!deps){await jobs.discardMedia(row);return VISION_DISABLED;}
 if(row.incoming_image?.status!=='ready'){await jobs.discardMedia(row);return VISION_UNSUPPORTED;}
 const caption=row.text.startsWith(INCOMING_IMAGE_TEXT)?row.text.slice(INCOMING_IMAGE_TEXT.length).trim():'';
 let bytes:Buffer,context:readonly VisionContext[];
 try{bytes=await deps.download();context=await deps.context();deps.validate(bytes,caption,context);}catch(e){await jobs.discardMedia(row);return e instanceof VisionError&&['INVALID_IMAGE','ANIMATED_IMAGE','UNTRUSTED_IMAGE_CDN','INVALID_IMAGE_KEY'].includes(e.code)?VISION_UNSUPPORTED:VISION_FAILURE;}
 const reservation=await jobs.reserve(row,deps.limit,deps.activeSinceMs);
 if(reservation.denied){await jobs.discardMedia(row);return VISION_LIMIT;}
 if(!reservation.fresh){if(reservation.job?.response)return reservation.job.response;return VISION_FAILURE;}
 let response:string;
 try{response=await deps.understand(bytes,caption,context);}catch(e){await jobs.save(row,'failed',VISION_FAILURE,e instanceof VisionError?e.code:'VISION_RESULT_UNKNOWN');return VISION_FAILURE;}
 // Commit failure propagates: the reservation stays durable and recovery will not call the model again.
 await jobs.save(row,'analyzed',response);return response;
}
export function createVisionDependencies(config:AppConfig,store:WeixinStore,row:WeixinRow,context:VisionDependencies['context'],signal:AbortSignal):VisionDependencies|undefined {
 if(!visionConfigured(config))return;
 const provider=new MiniMaxVisionProvider(config.MINIMAX_VISION_API_KEY!,config.MINIMAX_VISION_REGION!);
 return {jobs:new WeixinVisionStore(store),download:()=>downloadWeixinImage(row.incoming_image!,fetch,signal),context,validate:(...args)=>provider.validate(...args),understand:(...args)=>provider.understand(...args,signal),limit:config.VISION_MAX_PER_24H,activeSinceMs:Date.parse(config.VISION_ACTIVE_SINCE!)};
}
