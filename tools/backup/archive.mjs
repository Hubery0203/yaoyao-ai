/** Authenticated streaming backup. No network, subprocess, automatic file discovery or restore into a live DB. */
import {constants} from 'node:fs';
import {open,lstat,mkdir,rm,rename,link,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
const MAGIC=Buffer.from('YAOYAO1\n'),HEADER=20,TAG=16,MAX=1024**3;
const fail=code=>{throw Error(code);};
const safeName=n=>typeof n==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(n)&&!['RESTORED.json'].includes(n)&&n!=='.'&&n!=='..';
async function privateParent(file){const p=await lstat(dirname(resolve(file)));if(!p.isDirectory()||p.mode&0o077)fail('PRIVATE_PARENT_REQUIRED');}
async function privateFile(file,max=MAX){const f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.mode&0o077||s.size>max)fail('PRIVATE_REGULAR_FILE_REQUIRED');return {f,s};}catch(e){await f.close();throw e;}}
async function keyBytes(path){await privateParent(path);const {f,s}=await privateFile(path,32);try{if(s.size!==32)fail('KEY_MUST_BE_32_RANDOM_BYTES');return await f.readFile();}finally{await f.close();}}
async function hashHandle(f,size){const h=createHash('sha256');let at=0;const b=Buffer.alloc(65536);while(at<size){const {bytesRead}=await f.read(b,0,Math.min(b.length,size-at),at);if(!bytesRead)fail('SOURCE_TRUNCATED');h.update(b.subarray(0,bytesRead));at+=bytesRead;}return h.digest('hex');}
export async function readBackupPlan(path){await privateParent(path);const {f}=await privateFile(path,65536);try{return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}}
export async function createKey(out){await privateParent(out);const temp=resolve(out)+'.'+randomUUID()+'.tmp';const f=await open(temp,'wx',0o600);try{await f.writeFile(randomBytes(32));await f.sync();await f.close();await link(temp,resolve(out));return {created:true};}finally{await f.close().catch(()=>{});await unlink(temp).catch(()=>{});}}
export async function encryptBackup({entries,keyFile,out,maxBytes=MAX}){
 if(!Array.isArray(entries)||!entries.length||entries.length>32||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX)fail('INVALID_BACKUP_PLAN');
 await privateParent(out);const key=await keyBytes(keyFile),keyStat=await lstat(keyFile),sources=[],names=new Set();let temp,output;
 try{
  let total=0;for(const entry of entries){if(!safeName(entry.name)||names.has(entry.name)||typeof entry.path!=='string')fail('INVALID_ENTRY_NAME');names.add(entry.name);const src=await privateFile(entry.path,maxBytes);sources.push({...src,name:entry.name});if(src.s.dev===keyStat.dev&&src.s.ino===keyStat.ino)fail('KEY_MUST_BE_STORED_SEPARATELY');total+=src.s.size;if(total>maxBytes)fail('BACKUP_LIMIT');}
  const manifest={version:1,createdAtUTC:new Date().toISOString(),files:[]};
  for(const src of sources)manifest.files.push({name:src.name,bytes:src.s.size,sha256:await hashHandle(src.f,src.s.size)});
  const encoded=Buffer.from(JSON.stringify(manifest));if(encoded.length>65536)fail('MANIFEST_LIMIT');const length=Buffer.alloc(4);length.writeUInt32BE(encoded.length);
  const header=Buffer.concat([MAGIC,randomBytes(12)]),cipher=createCipheriv('aes-256-gcm',key,header.subarray(8),{authTagLength:TAG});cipher.setAAD(header);
  temp=resolve(out)+'.'+randomUUID()+'.tmp';output=await open(temp,'wx',0o600);await output.writeFile(header);await output.writeFile(cipher.update(length));await output.writeFile(cipher.update(encoded));
  for(let i=0;i<sources.length;i++){const src=sources[i],h=createHash('sha256');let at=0;const b=Buffer.alloc(65536);while(at<src.s.size){const {bytesRead}=await src.f.read(b,0,Math.min(b.length,src.s.size-at),at);if(!bytesRead)fail('SOURCE_TRUNCATED');const piece=b.subarray(0,bytesRead);h.update(piece);await output.writeFile(cipher.update(piece));at+=bytesRead;}const after=await src.f.stat();if(after.size!==src.s.size||h.digest('hex')!==manifest.files[i].sha256)fail('SOURCE_CHANGED');}
  await output.writeFile(cipher.final());await output.writeFile(cipher.getAuthTag());await output.sync();await output.close();output=null;
  // link() provides atomic no-overwrite publication in the same private directory.
  await link(temp,resolve(out));await unlink(temp);temp=null;return {version:1,files:manifest.files.length,plaintextBytes:total,encrypted:true};
 }finally{key.fill(0);await output?.close().catch(()=>{});if(temp)await unlink(temp).catch(()=>{});for(const s of sources)await s.f.close().catch(()=>{});}
}
class Reader{
 constructor(iterator){this.iterator=iterator;this.pending=Buffer.alloc(0);this.done=false;}
 async chunk(){if(this.pending.length){const b=this.pending;this.pending=Buffer.alloc(0);return b;}const r=await this.iterator.next();this.done=r.done===true;return r.done?null:r.value;}
 async exact(n){const parts=[];let remaining=n;while(remaining){const b=await this.chunk();if(!b)fail('TRUNCATED_ARCHIVE');const take=Math.min(remaining,b.length);parts.push(b.subarray(0,take));this.pending=b.subarray(take);remaining-=take;}return Buffer.concat(parts,n);}
 async file(n,out){const h=createHash('sha256');let remaining=n;while(remaining){const b=await this.chunk();if(!b)fail('TRUNCATED_ARCHIVE');const take=Math.min(remaining,b.length),piece=b.subarray(0,take);h.update(piece);await out.writeFile(piece);this.pending=b.subarray(take);remaining-=take;}return h.digest('hex');}
}
export async function restoreBackup({archive,keyFile,out,maxBytes=MAX}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX)fail('INVALID_RESTORE_LIMIT');await privateParent(out);const key=await keyBytes(keyFile);let input,created=false,source,decipher,done;
 try{
  const opened=await privateFile(archive,maxBytes+65536+HEADER+TAG+4);input=opened.f;const size=opened.s.size;if(size<HEADER+TAG+6)fail('TRUNCATED_ARCHIVE');
  const header=Buffer.alloc(HEADER),tag=Buffer.alloc(TAG);await input.read(header,0,HEADER,0);await input.read(tag,0,TAG,size-TAG);if(!header.subarray(0,8).equals(MAGIC))fail('INVALID_ARCHIVE');
  decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8),{authTagLength:TAG});decipher.setAAD(header);decipher.setAuthTag(tag);
  source=input.createReadStream({start:HEADER,end:size-TAG-1,autoClose:false,highWaterMark:65536});done=pipeline(source,decipher);done.catch(()=>{});
  const reader=new Reader(decipher[Symbol.asyncIterator]()),length=(await reader.exact(4)).readUInt32BE();if(length<2||length>65536)fail('MANIFEST_LIMIT');
  const manifest=JSON.parse((await reader.exact(length)).toString('utf8'));if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>32)fail('INVALID_MANIFEST');
  const names=new Set();let total=0;for(const f of manifest.files){if(!safeName(f.name)||names.has(f.name)||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^[a-f0-9]{64}$/.test(f.sha256))fail('INVALID_MANIFEST');names.add(f.name);total+=f.bytes;if(total>maxBytes)fail('RESTORE_LIMIT');}
  // Reserve a NEW private directory. Existing paths are never modified or recursively removed.
  await mkdir(out,{mode:0o700});created=true;const stage=join(out,'.staging');await mkdir(stage,{mode:0o700});
  for(const f of manifest.files){const dest=await open(join(stage,f.name),'wx',0o600);try{const digest=await reader.file(f.bytes,dest);if(digest!==f.sha256)fail('MANIFEST_HASH_MISMATCH');await dest.sync();}finally{await dest.close();}}
  if(await reader.chunk()!==null)fail('TRAILING_ARCHIVE_DATA');await done; // final() verifies the GCM tag before any file is promoted.
  for(const f of manifest.files)await rename(join(stage,f.name),join(out,f.name));await rm(stage,{recursive:true});
  const receipt=await open(join(out,'RESTORED.json'),'wx',0o600);try{await receipt.writeFile(JSON.stringify({authenticated:true,manifestVerified:true,...manifest},null,2)+'\n');await receipt.sync();}finally{await receipt.close();}
  return {files:manifest.files.length,plaintextBytes:total,authenticated:true,manifestVerified:true,liveDatabaseTouched:false};
 }catch(e){if(created)await rm(out,{recursive:true,force:true});throw e;}
 finally{key.fill(0);source?.destroy();decipher?.destroy();await done?.catch(()=>{});await input?.close().catch(()=>{});}
}
