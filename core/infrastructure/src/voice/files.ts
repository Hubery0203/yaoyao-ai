import {constants} from 'node:fs';
import {open,lstat,mkdir,readdir,unlink,link} from 'node:fs/promises';
import {isAbsolute,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const VOICE_MAX_BYTES=2*1024*1024;
/** Checks a bounded MP3 header/frame, not a full decoder or duration claim. */
export function validateMp3(bytes:Buffer):void{
 if(bytes.length<4||bytes.length>VOICE_MAX_BYTES)throw Error('INVALID_VOICE_AUDIO');let offset=0;
 if(bytes.toString('ascii',0,3)==='ID3'){
  if(bytes.length<14||![2,3,4].includes(bytes[3])||bytes.subarray(6,10).some(v=>v>127))throw Error('INVALID_VOICE_AUDIO');
  offset=10+((bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9]);if(bytes[3]===4&&(bytes[5]&16))offset+=10;
 }
 const a=bytes[offset],b=bytes[offset+1],c=bytes[offset+2];
 if(offset+4>bytes.length||a!==255||(b&224)!==224||((b>>3)&3)===1||((b>>1)&3)!==1||(c>>4)===0||(c>>4)===15||((c>>2)&3)===3)throw Error('INVALID_VOICE_AUDIO');
}
export async function readPrivateVoice(path:string):Promise<Buffer>{
 if(!isAbsolute(path))throw Error('ABSOLUTE_VOICE_PATH_REQUIRED');const parent=await lstat(dirname(path));if(!parent.isDirectory()||parent.isSymbolicLink()||parent.mode&0o077)throw Error('PRIVATE_VOICE_DIRECTORY_REQUIRED');
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.mode&0o077||s.size>VOICE_MAX_BYTES)throw Error('PRIVATE_VOICE_FILE_REQUIRED');const bytes=await f.readFile();validateMp3(bytes);return bytes;}finally{await f.close();}
}
export class VoiceFiles{
 constructor(readonly directory:string){}
 async available():Promise<void>{
  if(!isAbsolute(this.directory))throw Error('ABSOLUTE_VOICE_STORAGE_REQUIRED');await mkdir(this.directory,{recursive:true,mode:0o700});const s=await lstat(this.directory);if(!s.isDirectory()||s.isSymbolicLink()||s.mode&0o077)throw Error('PRIVATE_VOICE_STORAGE_REQUIRED');
  let total=0;for(const name of await readdir(this.directory)){const path=join(this.directory,name),s=await lstat(path);if(!s.isFile())continue;if((/^[a-f0-9]{64}\.mp3$/.test(name)||/^[a-f0-9-]{36}\.tmp$/.test(name))&&Date.now()-s.mtimeMs>86400000){await unlink(path);continue;}total+=s.size;}if(total>30*1024*1024)throw Error('VOICE_STORAGE_FULL');
  // Check writable storage before a paid reservation; do not discover a read-only mount after synthesis.
  const probe=join(this.directory,randomUUID()+'.tmp'),f=await open(probe,'wx',0o600);try{await f.writeFile(Buffer.alloc(1));await f.sync();}finally{await f.close();await unlink(probe);}
 }
 async save(bytes:Buffer):Promise<string>{
  validateMp3(bytes);await this.available();const id=createHash('sha256').update(bytes).digest('hex'),temp=join(this.directory,randomUUID()+'.tmp'),dest=join(this.directory,id+'.mp3'),f=await open(temp,'wx',0o600);
  try{await f.writeFile(bytes);await f.sync();await f.close();try{await link(temp,dest);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const prior=await readPrivateVoice(dest);if(!prior.equals(bytes))throw Error('VOICE_ARTIFACT_CONFLICT');}return id;}finally{await f.close().catch(()=>{});await unlink(temp).catch(()=>{});}
 }
 async read(id:string):Promise<Buffer>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('INVALID_VOICE_ARTIFACT');return readPrivateVoice(join(this.directory,id+'.mp3'));}
}
