export const VISION_MAX_BYTES=4*1024*1024;
export type VisionFailureReason='MISSING_BODY'|'RESPONSE_TOO_LARGE'|'NON_JSON'|'CONTENT_TYPE'|'EMPTY_CONTENT'|'CONTENT_TOO_LONG'|'CONTROL_CHARACTERS'|'UNSAFE_REPLY';
export class VisionError extends Error {constructor(readonly code:string,readonly reason?:VisionFailureReason){super(code);}}
export interface VisionImageInfo {mime:'image/png'|'image/jpeg'|'image/webp';width:number;height:number}
/** Header-only inspection: no local decompression or native decoder on the small VPS. */
export function inspectVisionImage(bytes:Buffer):VisionImageInfo {
 if(bytes.length<24||bytes.length>VISION_MAX_BYTES)throw new VisionError('INVALID_IMAGE');
 let mime:VisionImageInfo['mime'],width=0,height=0;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(8)===13){mime='image/png';width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
 else if(bytes[0]===255&&bytes[1]===216){
  mime='image/jpeg';let offset=2;
  while(offset+4<=bytes.length){
   if(bytes[offset++]!==255)throw new VisionError('INVALID_IMAGE');
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];if(marker===217||marker===218)break;
   if(marker===1||marker>=208&&marker<=215)continue;
   if(offset+2>bytes.length)break;const size=bytes.readUInt16BE(offset);
   if(size<2||offset+size>bytes.length)throw new VisionError('INVALID_IMAGE');
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(size<8)throw new VisionError('INVALID_IMAGE');height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;
   }offset+=size;
  }
 }else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length){
  mime='image/webp';const type=bytes.toString('ascii',12,16);
  if(type==='VP8X'&&bytes.length>=30){if(bytes[20]&2)throw new VisionError('ANIMATED_IMAGE');width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}
  else if(type==='VP8L'&&bytes.length>=25&&bytes[20]===47){const n=bytes.readUInt32LE(21);width=1+(n&16383);height=1+((n>>>14)&16383);}
  else if(type==='VP8 '&&bytes.length>=30&&bytes.subarray(23,26).equals(Buffer.from([157,1,42]))){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}
 }else throw new VisionError('INVALID_IMAGE');
 if(!width||!height||width>8192||height>8192||width*height>16000000)throw new VisionError('INVALID_IMAGE');
 return {mime:mime!,width,height};
}
