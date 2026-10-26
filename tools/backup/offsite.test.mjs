import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,rm,stat,open,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createKey,encryptBackup} from './archive.mjs';
import {SshRepository} from './ssh-repository.mjs';
import {publishBackup,verifyStoredBackup,retainBackups,objectName,validObjectName} from './offsite.mjs';
const python=process.platform==='darwin'?'/usr/bin/python3':'python3';
async function fixture(fn){
 const root=await realpath(await mkdtemp(join(tmpdir(),'yaoyao-offsite-')));await chmod(root,0o700);
 try{
  const keyFile=join(root,'key'),archive=join(root,'a.yyb'),source=join(root,'source');await createKey(keyFile);await writeFile(source,'synthetic database only',{mode:0o600});await encryptBackup({entries:[{name:'database.dump',path:source}],keyFile,out:archive});
  const identityFile=join(root,'upload-key'),knownHostsFile=join(root,'hosts');await writeFile(identityFile,'SYNTHETIC LOCAL TEST KEY',{mode:0o600});await writeFile(knownHostsFile,'synthetic pinned host');
  const config={driver:'ssh',host:'example.test',user:'yaoyao-backup',port:22,namespace:'a'.repeat(32),identityFile,knownHostsFile};const calls=[];
  const launcher=(exe,argv)=>{calls.push({exe,argv});const encoded=argv.at(-1).split(' ')[1];return spawn(python,['-c',`import importlib.util,json,base64,sys\ns=importlib.util.spec_from_file_location('receiver',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.run(json.loads(sys.argv[2]),json.loads(base64.urlsafe_b64decode(sys.argv[3]+'='*((-len(sys.argv[3]))%4))),sys.stdin.buffer,sys.stdout.buffer)`,resolve('tools/backup/receiver.py'),JSON.stringify({directory:join(root,'remote'),namespace:config.namespace}),encoded],{stdio:['pipe','pipe','pipe']});};
  const repository=new SshRepository(config,{launcher});await repository.init();const sha=createHash('sha256').update(await readFile(archive)).digest('hex'),name=objectName(sha),receipt=join(root,'receipt.json');
  await fn({root,keyFile,archive,repository,name,receipt,calls,config,sha});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('local protocol double publishes ciphertext, re-downloads and authenticates; strict SSH argv',()=>fixture(async f=>{
 assert.deepEqual(f.calls[0].argv.slice(0,2),['-F','/dev/null']);assert.ok(f.calls[0].argv.includes('GlobalKnownHostsFile=/dev/null'));assert.ok(f.calls[0].argv.includes('IdentityAgent=none'));
 const r=await publishBackup(f);assert.equal(r.authenticated,true);assert.equal(r.manifestVerified,true);assert.equal(r.keyEscrowVerified,false);assert.equal(r.liveDatabaseTouched,false);
 assert.deepEqual(await readFile(join(f.root,'remote',f.name)),await readFile(f.archive));assert.equal((await stat(join(f.root,'remote',f.name))).mode&0o077,0);
 const c=f.calls[0];assert.equal(c.exe,'/usr/bin/ssh');for(const flag of ['StrictHostKeyChecking=yes','IdentitiesOnly=yes','ProxyCommand=none','ControlPath=none'])assert.ok(c.argv.includes(flag));assert.ok(!c.argv.join(' ').includes('SYNTHETIC LOCAL TEST KEY'));
 const v=await verifyStoredBackup({...f,out:join(f.root,'verify.json')});assert.equal(v.authenticated,true);
 const calls=f.calls.length;await assert.rejects(publishBackup(f),/RECEIPT_ALREADY_EXISTS/);assert.equal(f.calls.length,calls);
}));
test('interrupted publication resumes exact pending plan and idempotent upload',()=>fixture(async f=>{
 const get=f.repository.get.bind(f.repository);f.repository.get=async()=>{throw Error('synthetic outage');};await assert.rejects(publishBackup(f));await assert.rejects(stat(f.receipt));assert.ok(await stat(f.receipt+'.pending'));
 f.repository.get=get;assert.equal((await publishBackup(f)).verified,true);await assert.rejects(stat(f.receipt+'.pending'));
}));
test('tampered remote download never produces success receipt or permits cleanup',()=>fixture(async f=>{
 const get=f.repository.get.bind(f.repository);f.repository.get=async(name,dest,limit)=>{await get(name,dest,limit);await dest.write(Buffer.from('X'),0,1,30);};await assert.rejects(publishBackup(f),/REMOTE_HASH_MISMATCH/);await assert.rejects(stat(f.receipt));await assert.rejects(retainBackups(f));
}));
test('wrong key fails authentication after upload without a success receipt',()=>fixture(async f=>{
 const wrong=join(f.root,'wrong');await createKey(wrong);await assert.rejects(publishBackup({...f,keyFile:wrong}));await assert.rejects(stat(f.receipt));
}));
test('plaintext, public archive and repository injection rejected before transport',()=>fixture(async f=>{
 const calls=f.calls.length;await writeFile(f.archive,'private but plaintext',{mode:0o600});await assert.rejects(publishBackup(f),/ENCRYPTED_ARCHIVE_REQUIRED/);await chmod(f.archive,0o644);await assert.rejects(publishBackup(f));assert.equal(f.calls.length,calls);
 for(const host of ['-oProxyCommand=evil','ok\n','a;evil','a b'])assert.throws(()=>new SshRepository({...f.config,host}));
 assert.equal(validObjectName('../x'),false);assert.equal(validObjectName('yaoyao-20260230T000000Z-'+'a'.repeat(16)+'.yyb'),false);
}));
test('retention previews by default; keeps verified object and two newest; stale receipt blocks delete',()=>fixture(async f=>{
 await publishBackup(f);
 const bytes=await readFile(f.archive);for(const time of ['2026-01-01','2026-01-02','2026-01-03']){const name=objectName(f.sha,new Date(time));await writeFile(join(f.root,'remote',name),bytes,{mode:0o600});}
 const result=await retainBackups({...f,keep:2});assert.equal(result.dryRun,true);assert.equal(result.deleted,0);assert.equal(result.candidates.length,2);
 const apply=await retainBackups({...f,keep:2,apply:true});assert.equal(apply.deleted,2);assert.equal((await f.repository.list()).length,2);
 await assert.rejects(retainBackups({...f,keep:1}),/KEEP_AT_LEAST_TWO/);await assert.rejects(retainBackups({...f,now:new Date(Date.now()+3600000)}),/FRESH_VERIFICATION_REQUIRED/);
 await assert.rejects(f.repository.remove(f.name,f.sha));
}));
test('receiver rejects wrong namespace, oversized upload and plaintext hash-correct body',()=>fixture(async f=>{
 const wrong=new SshRepository({...f.config,namespace:'b'.repeat(32)},{launcher:f.repository.launcher});await assert.rejects(wrong.list());
 await assert.rejects(f.repository.rpc('put',{name:f.name,sha256:f.sha,bytes:64*1024*1024+1}));
 const plain=Buffer.alloc(64,65),sha=createHash('sha256').update(plain).digest('hex');const p=join(f.root,'plain');await writeFile(p,plain,{mode:0o600});const file=await open(p);try{await assert.rejects(f.repository.put(objectName(sha),file.createReadStream({autoClose:false}),{sha256:sha,bytes:64}));}finally{await file.close();}assert.equal((await f.repository.list()).length,0);
}));

test('remote symlink never becomes readable ciphertext or a retention candidate',()=>fixture(async f=>{
 await symlink(f.archive,join(f.root,'remote',f.name));await assert.rejects(f.repository.list());await assert.rejects(f.repository.stat(f.name));await assert.rejects(publishBackup(f));await assert.rejects(stat(f.receipt));
}));
test('download truncation fails verification before receipt publication',()=>fixture(async f=>{
 f.repository.get=async(_name,dest)=>{await dest.writeFile(Buffer.from('truncated'));};await assert.rejects(publishBackup(f),/REMOTE_HASH_MISMATCH/);await assert.rejects(stat(f.receipt));
}));
