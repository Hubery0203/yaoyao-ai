/** Verified ciphertext publication and opt-in retention. No provider discovery, key upload or live DB restore. */
import {constants} from 'node:fs';
import {Readable} from 'node:stream';
import {open,lstat,mkdtemp,rm,link,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {restoreBackup} from './archive.mjs';
const MAX=1024**3+65576,MAGIC=Buffer.from('YAOYAO1\n');
const fail=code=>{throw Error(code);};
export function validObjectName(name){
 if(typeof name!=='string'||!/^yaoyao-\d{8}T\d{6}Z-[a-f0-9]{16}\.yyb$/.test(name))return false;
 const t=name.slice(7,23),iso=t.slice(0,4)+'-'+t.slice(4,6)+'-'+t.slice(6,8)+'T'+t.slice(9,11)+':'+t.slice(11,13)+':'+t.slice(13,15)+'Z',d=new Date(iso);
 return Number.isFinite(d.getTime())&&d.toISOString().replace(/[-:]/g,'').replace('.000','')===t;
}
export function objectName(sha256,now=new Date()){if(!/^[a-f0-9]{64}$/.test(sha256)||!Number.isFinite(now.getTime()))fail('INVALID_OBJECT');return 'yaoyao-'+now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'-'+sha256.slice(0,16)+'.yyb';}
export async function privateParent(path){const p=await lstat(dirname(resolve(path)));if(!p.isDirectory()||p.isSymbolicLink()||p.mode&0o077)fail('PRIVATE_PARENT_REQUIRED');}
export async function privateRead(path,max=MAX){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.mode&0o077||s.size>max)fail('PRIVATE_REGULAR_FILE_REQUIRED');return {f,s};}catch(e){await f.close();throw e;}}
export async function hashFile(f,bytes){const h=createHash('sha256'),b=Buffer.alloc(65536);let at=0;while(at<bytes){const r=await f.read(b,0,Math.min(b.length,bytes-at),at);if(!r.bytesRead)fail('SOURCE_TRUNCATED');h.update(b.subarray(0,r.bytesRead));at+=r.bytesRead;}return h.digest('hex');}
async function keyFingerprint(keyFile){await privateParent(keyFile);const {f,s}=await privateRead(keyFile,32);try{if(s.size!==32)fail('INVALID_KEY');const bytes=await f.readFile();try{return createHash('sha256').update(bytes).digest('hex');}finally{bytes.fill(0);}}finally{await f.close();}}
export async function readPrivateJson(path){await privateParent(path);const {f}=await privateRead(path,65536);try{return JSON.parse(await f.readFile('utf8'));}finally{await f.close();}}
async function publishJson(path,value){await privateParent(path);const tmp=resolve(path)+'.'+randomUUID()+'.tmp',f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();await f.close();await link(tmp,path);}finally{await f.close().catch(()=>{});await unlink(tmp).catch(()=>{});}}
function planCheck(p,repo){if(p?.version!==1||p.repository!==repo.id||!validObjectName(p.name)||!/^[a-f0-9]{64}$/.test(p.sha256)||!p.name.endsWith(p.sha256.slice(0,16)+'.yyb')||!Number.isSafeInteger(p.bytes)||p.bytes<36||p.bytes>MAX||!/^[a-f0-9]{64}$/.test(p.keyFingerprint))fail('INVALID_OFFSITE_RECEIPT');}
async function verifyRemote({repository,plan,keyFile,workspace}){
 const file=join(workspace,'download.yyb'),dest=await open(file,'wx+',0o600);
 try{await repository.get(plan.name,dest,{maxBytes:plan.bytes});await dest.sync();const s=await dest.stat();if(s.size!==plan.bytes||await hashFile(dest,s.size)!==plan.sha256)fail('REMOTE_HASH_MISMATCH');}finally{await dest.close();}
 const result=await restoreBackup({archive:file,keyFile,out:join(workspace,'authenticated')});
 return {authenticated:result.authenticated,manifestVerified:result.manifestVerified,files:result.files};
}
/** A successful receipt proves download+hash+GCM, not bare-machine recovery or separate key escrow. */
export async function publishBackup({archive,keyFile,repository,name,receipt}){
 if(!repository||typeof repository.id!=='string'||!validObjectName(name))fail('INVALID_REPOSITORY');
 await privateParent(receipt);try{await lstat(receipt);fail('RECEIPT_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}await privateParent(archive);const {f,s}=await privateRead(archive);let workspace;
 try{
  const header=Buffer.alloc(8);await f.read(header,0,8,0);if(!header.equals(MAGIC))fail('ENCRYPTED_ARCHIVE_REQUIRED');
  const plan={version:1,repository:repository.id,name,sha256:await hashFile(f,s.size),bytes:s.size,keyFingerprint:await keyFingerprint(keyFile)};planCheck(plan,repository);
  const pending=receipt+'.pending';try{const prior=await readPrivateJson(pending);if(JSON.stringify(prior)!==JSON.stringify(plan))fail('PENDING_RECEIPT_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;await publishJson(pending,plan);}
  // Pinned descriptor, bounded stream; pathname replacement cannot upload a different secret file.
  const stream=Readable.from((async function*(){let at=0;while(at<s.size){const b=Buffer.alloc(Math.min(65536,s.size-at)),r=await f.read(b,0,b.length,at);if(!r.bytesRead)fail('SOURCE_TRUNCATED');at+=r.bytesRead;yield b.subarray(0,r.bytesRead);}})());try{await repository.put(name,stream,{sha256:plan.sha256,bytes:s.size});}finally{stream.destroy();}
  const after=await f.stat();if(after.size!==s.size)fail('SOURCE_CHANGED');workspace=await mkdtemp(join(dirname(resolve(receipt)),'.offsite-verify-'));
  const verified=await verifyRemote({repository,plan,keyFile,workspace}),result={...plan,verified:true,...verified,verifiedAtUTC:new Date().toISOString(),keyEscrowVerified:false,liveDatabaseTouched:false};
  await publishJson(receipt,result);await unlink(pending);return result;
 }finally{await f.close();if(workspace)await rm(workspace,{recursive:true,force:true});}
}
export async function verifyStoredBackup({repository,receipt,keyFile,out}){
 const p=await readPrivateJson(receipt);planCheck(p,repository);if(p.keyFingerprint!==await keyFingerprint(keyFile))fail('KEY_FINGERPRINT_MISMATCH');await privateParent(out);let workspace;
 try{workspace=await mkdtemp(join(dirname(resolve(out)),'.offsite-verify-'));const verified=await verifyRemote({repository,plan:p,keyFile,workspace}),result={version:1,repository:p.repository,name:p.name,sha256:p.sha256,bytes:p.bytes,keyFingerprint:p.keyFingerprint,verified:true,...verified,verifiedAtUTC:new Date().toISOString(),keyEscrowVerified:false,liveDatabaseTouched:false};await publishJson(out,result);return result;}finally{if(workspace)await rm(workspace,{recursive:true,force:true});}
}
/** Preview by default. Apply requires a fresh successful receipt and an unchanged verified object. */
export async function retainBackups({repository,receipt,keep=14,apply=false,now=new Date()}){
 if(!Number.isSafeInteger(keep)||keep<2||keep>90)fail('KEEP_AT_LEAST_TWO');
 const p=await readPrivateJson(receipt);planCheck(p,repository);const age=now.getTime()-Date.parse(p.verifiedAtUTC);
 if(p.verified!==true||p.authenticated!==true||p.manifestVerified!==true||!Number.isFinite(age)||age<0||age>1800000)fail('FRESH_VERIFICATION_REQUIRED');
 const latest=await repository.stat(p.name);if(latest?.sha256!==p.sha256||latest.bytes!==p.bytes)fail('VERIFIED_OBJECT_CHANGED');
 const list=await repository.list();if(!Array.isArray(list)||list.length>1000)fail('REPOSITORY_LIMIT');const names=new Set();
 const eligible=list.filter(v=>validObjectName(v.name)&&!names.has(v.name)&&names.add(v.name)).sort((a,b)=>b.name.localeCompare(a.name));
 if(!eligible.some(v=>v.name===p.name))fail('VERIFIED_OBJECT_MISSING');
 const candidates=eligible.slice(keep).filter(v=>v.name!==p.name);let deleted=0;
 if(apply)for(const item of candidates){const current=await repository.stat(item.name);if(!current||!current.sha256.startsWith(item.name.slice(-20,-4)))fail('RETENTION_OBJECT_CHANGED');await repository.remove(item.name,current.sha256);deleted++;}
 return {dryRun:!apply,keep,candidates:candidates.map(v=>v.name),deleted,verifiedBackupRetained:true};
}
