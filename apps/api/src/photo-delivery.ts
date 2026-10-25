import {photoRequest,PHOTO_CAPTION,PHOTO_FAILURE} from '@yaoyao/application';
import {PhotoFiles,OpenAIImageProvider,readPrivatePhoto,uploadWeixinImage,WeixinPhotoStore,type AppConfig,type WeixinRow,type WeixinClient,type WeixinStore} from '@yaoyao/infrastructure';
export interface PhotoDependencies {
 jobs:Pick<WeixinPhotoStore,'reserve'|'save'|'get'>;
 files:Pick<PhotoFiles,'available'|'save'|'read'>;
 generate:(scene:string,reference:Buffer)=>Promise<Buffer>;
 reference:()=>Promise<Buffer>;
 upload:(bytes:Buffer)=>ReturnType<typeof uploadWeixinImage>;
 limit:number;
}
/** A fresh durable reservation is the ONLY authority to begin a paid request. Never retry unknown generation. */
export async function prepareWeixinPhoto(row:WeixinRow,deps:PhotoDependencies):Promise<string>{
 const scene=photoRequest(row.text);if(scene===null)throw Error('NOT_PHOTO_REQUEST');
 // Configuration, disk permissions and reference are checked before consuming a reservation.
 let reference:Buffer;try{reference=await deps.reference();await deps.files.available();}catch{return '照片配置暂时不可用，等修好再拍。';}
 const {job,fresh,denied}=await deps.jobs.reserve(row,deps.limit);
 if(denied)return '这次先不拍啦，稍后再试。';if(!job)throw Error('PHOTO_RESERVATION_MISSING');
 let current=job;
 if(current.state==='reserved'){
  if(!fresh){await deps.jobs.save(row,'failed');return PHOTO_FAILURE;}
  let artifact:string;
  try{artifact=await deps.files.save(await deps.generate(scene,reference));}catch{await deps.jobs.save(row,'failed');return PHOTO_FAILURE;}
  // A failed DB commit cannot authorize another paid attempt. Save errors propagate for recovery.
  await deps.jobs.save(row,'generated',artifact);current={state:'generated',artifact,media:null};
 }
 if(current.state==='failed')return PHOTO_FAILURE;
 if(current.state==='generated'){
  if(!current.artifact)throw Error('PHOTO_ARTIFACT_MISSING');
  let bytes:Buffer;try{bytes=await deps.files.read(current.artifact);}catch{await deps.jobs.save(row,'failed');return PHOTO_FAILURE;}
  const media=await deps.upload(bytes);await deps.jobs.save(row,'uploaded',null,media);
 }
 return PHOTO_CAPTION;
}
export function createPhotoDependencies(config:AppConfig,store:WeixinStore,client:WeixinClient,signal:AbortSignal):PhotoDependencies|undefined{
 if(config.PHOTOS_ENABLED!=='1'||!config.OPENAI_IMAGE_API_KEY||!config.PHOTO_REFERENCE_FILE||!config.PHOTO_STORAGE_DIR)return;
 const provider=new OpenAIImageProvider(config.OPENAI_IMAGE_API_KEY,config.OPENAI_IMAGE_MODEL);
 return {jobs:new WeixinPhotoStore(store),files:new PhotoFiles(config.PHOTO_STORAGE_DIR),reference:()=>readPrivatePhoto(config.PHOTO_REFERENCE_FILE!),generate:(scene,reference)=>provider.generate(scene,reference,signal),upload:bytes=>uploadWeixinImage(client,bytes,fetch,signal),limit:config.PHOTO_MAX_PER_24H};
}
