import {inspectVisionImage,VISION_MAX_BYTES,VisionError} from '../vision/image-input.js';
import {parseEncryptedCdnMedia,downloadEncryptedCdn,CdnMediaError,trustedCdnDownload} from './cdn-download.js';
export {trustedCdnDownload};
export type IncomingImage={status:'ready';url:string;aesKey:string}|{status:'unsupported'|'consumed'};
export function parseIncomingImage(value:unknown):IncomingImage {
 if(!value||typeof value!=='object')return {status:'unsupported'};const v=value as Record<string,unknown>,media=parseEncryptedCdnMedia(v.media,v.aeskey);return media?{status:'ready',...media}:{status:'unsupported'};
}
export async function downloadWeixinImage(image:IncomingImage,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<Buffer>{
 if(image.status!=='ready')throw new VisionError('INVALID_IMAGE');
 try{const bytes=await downloadEncryptedCdn(image,VISION_MAX_BYTES,fetcher,signal);inspectVisionImage(bytes);return bytes;}
 catch(e){if(e instanceof CdnMediaError)throw new VisionError(e.code==='DOWNLOAD_FAILED'?'IMAGE_DOWNLOAD_FAILED':e.code==='UNTRUSTED_CDN'?'UNTRUSTED_IMAGE_CDN':'INVALID_IMAGE');throw e;}
}
