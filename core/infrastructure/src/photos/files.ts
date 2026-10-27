import {constants} from 'node:fs';
import {open,lstat,mkdir,readdir,unlink,rename} from 'node:fs/promises';
import {isAbsolute,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const PHOTO_MAX_BYTES=4*1024*1024;
export function imageMime(bytes:Buffer):'image/png'|'image/jpeg'{
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.toString('ascii',12,16)==='IHDR')return 'image/png';
 if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
 throw Error('INVALID_PHOTO_FORMAT');
}
export async function readPrivatePhoto(path:string,expectedSha256?:string):Promise<Buffer>{
 if(expectedSha256!==undefined&&!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('INVALID_PHOTO_REFERENCE_HASH');
 if(!isAbsolute(path))throw Error('ABSOLUTE_PHOTO_PATH_REQUIRED');
 const parent=await lstat(dirname(path));if(!parent.isDirectory()||parent.mode&0o077)throw Error('PRIVATE_PHOTO_DIRECTORY_REQUIRED');
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await f.stat();if(!s.isFile()||s.mode&0o077||s.size>PHOTO_MAX_BYTES||s.size<4)throw Error('PRIVATE_PHOTO_FILE_REQUIRED');const b=await f.readFile();if(b.length>PHOTO_MAX_BYTES)throw Error('PHOTO_TOO_LARGE');imageMime(b);if(expectedSha256!==undefined&&createHash('sha256').update(b).digest('hex')!==expectedSha256)throw Error('PHOTO_REFERENCE_MISMATCH');return b;}finally{await f.close();}
}
/** Private bounded spool; file names never derive from user-controlled paths. No HTTP file server. */
export class PhotoFiles {
 constructor(readonly directory:string){}
 private async directoryReady(){if(!isAbsolute(this.directory))throw Error('ABSOLUTE_PHOTO_STORAGE_REQUIRED');await mkdir(this.directory,{recursive:true,mode:0o700});const s=await lstat(this.directory);if(!s.isDirectory()||s.mode&0o077)throw Error('PRIVATE_PHOTO_STORAGE_REQUIRED');}
 async available():Promise<void>{
  await this.directoryReady();let total=0;
  for(const n of await readdir(this.directory)){const path=join(this.directory,n),s=await lstat(path);if(!s.isFile())continue;if((/^[a-f0-9]{64}\.img$/.test(n)||/^[a-f0-9-]{36}\.tmp$/.test(n))&&Date.now()-s.mtimeMs>86400000){await unlink(path);continue;}total+=s.size;}
  if(total>28*1024*1024)throw Error('PHOTO_STORAGE_FULL');
 }
 async save(bytes:Buffer):Promise<string>{
  if(bytes.length>PHOTO_MAX_BYTES)throw Error('PHOTO_TOO_LARGE');imageMime(bytes);await this.available();
  const id=createHash('sha256').update(bytes).digest('hex'),dest=join(this.directory,id+'.img'),temp=join(this.directory,randomUUID()+'.tmp');
  const f=await open(temp,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
  await rename(temp,dest);return id;
 }
 async read(id:string):Promise<Buffer>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('INVALID_PHOTO_ARTIFACT');return readPrivatePhoto(join(this.directory,id+'.img'));}
 async remove(id:string):Promise<void>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('INVALID_PHOTO_ARTIFACT');await unlink(join(this.directory,id+'.img')).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
