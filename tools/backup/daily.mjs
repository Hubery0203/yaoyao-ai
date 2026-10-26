#!/usr/bin/env node
/** Install only after offsite approval. Reuses the existing DB-dump timer via ExecStartPost. */
import {mkdtemp,rm,realpath,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {readPrivateJson,privateParent,privateRead,hashFile,objectName,publishBackup,retainBackups} from './offsite.mjs';
import {SshRepository} from './ssh-repository.mjs';
import {createSnapshot} from './snapshot.mjs';
import {captureDatabase} from './capture.mjs';
try{
 if(process.argv.length!==4||process.argv[2]!=='--config')throw Error('USAGE_PRIVATE_DAILY_CONFIG');
 const c=await readPrivateJson(process.argv[3]);if(c.keyEscrowConfirmed!==true)throw Error('KEY_ESCROW_REQUIRED');
 if(typeof c.dumpDirectory!=='string'||typeof c.workspace!=='string'||typeof c.releaseFile!=='string')throw Error('EXPLICIT_DAILY_PATHS_REQUIRED');
 await privateParent(join(c.workspace,'probe'));const s=await lstat(c.workspace);if(!s.isDirectory()||s.isSymbolicLink())throw Error('PRIVATE_WORKSPACE_REQUIRED');
 // The existing backup service names a fresh, fully promoted .dump. No temp/glob discovery elsewhere.
 const {readdir}=await import('node:fs/promises');const names=(await readdir(c.dumpDirectory)).filter(n=>/^yaoyao-\d{8}T\d{6}Z\.dump$/.test(n)).sort();if(!names.length)throw Error('FRESH_DUMP_REQUIRED');
 // Bound retained failed runs; do not delete evidence automatically.
 const {readdir:scan}=await import('node:fs/promises');let retained=0,entries=0;
 async function measure(path,depth=0){if(depth>4||++entries>10000)throw Error('LOCAL_SPOOL_CAPACITY');const s=await lstat(path);if(s.isSymbolicLink())throw Error('PRIVATE_SPOOL_REQUIRED');if(s.isFile())retained+=s.size;else if(s.isDirectory())for(const n of await scan(path))await measure(join(path,n),depth+1);else throw Error('PRIVATE_SPOOL_REQUIRED');}
 for(const n of await scan(c.workspace))if(/^run-/.test(n))await measure(join(c.workspace,n));if(retained>128*1024*1024)throw Error('LOCAL_SPOOL_CAPACITY');
 const run=await mkdtemp(join(c.workspace,'run-'));let success=false;
 try{
  const releaseTarget=await realpath(c.releaseFile),releaseFile=join(run,'release.json');
  // Public release metadata may be copied privately; credentials still require private source files.
  const {readFile,writeFile}=await import('node:fs/promises');const release=await readFile(releaseTarget);let deploymentMetadata;let deploymentBytes;if(c.deploymentMetadataFile){deploymentBytes=await readFile(c.deploymentMetadataFile);if(deploymentBytes.length>65536)throw Error('RELEASE_METADATA_LIMIT');deploymentMetadata=JSON.parse(deploymentBytes.toString('utf8'));}if(release.length>65536)throw Error('RELEASE_METADATA_LIMIT');await writeFile(releaseFile,release,{mode:0o600});
  const archive=join(run,'snapshot.yyb');const tracked=[c.apiEnv,c.weixinAuth,c.reference];
  async function fingerprints(){const out=[];for(const path of tracked){const {f,s}=await privateRead(path,48*1024*1024);try{out.push(await hashFile(f,s.size));}finally{await f.close();}}return JSON.stringify(out);}
  const before=await fingerprints();
  let dump=join(c.dumpDirectory,names.at(-1));
  if(c.captureConfig){const captured=await captureDatabase({...await readPrivateJson(c.captureConfig),out:join(run,'consistent.dump'),evidenceOut:join(run,'database-evidence.json')});dump=join(run,'consistent.dump');await writeFile(releaseFile,JSON.stringify({...JSON.parse(release.toString('utf8')),deploymentMetadata,backupEvidence:captured}),{mode:0o600});}
  await createSnapshot({dump,apiEnv:c.apiEnv,weixinAuth:c.weixinAuth,reference:c.reference,release:releaseFile,keyFile:c.keyFile,out:archive});
  if(deploymentBytes&&!(await readFile(c.deploymentMetadataFile)).equals(deploymentBytes))throw Error('SNAPSHOT_CONFIGURATION_CHANGED');
  if(await realpath(c.releaseFile)!==releaseTarget||!(await readFile(releaseTarget)).equals(release)||await fingerprints()!==before)throw Error('SNAPSHOT_CONFIGURATION_CHANGED');
  const repository=new SshRepository(await readPrivateJson(c.repositoryConfig)),{f,s}=await privateRead(archive);let name;try{name=objectName(await hashFile(f,s.size));}finally{await f.close();}
  const receipt=join(run,'receipt.json');const result=await publishBackup({archive,keyFile:c.keyFile,repository,name,receipt});
  const retention=await retainBackups({repository,receipt,keep:7,apply:c.applyRetention===true});success=true;
  // The receipt stays private; only finite status/count fields are emitted to the service journal.
  console.log(JSON.stringify({verified:result.verified,authenticated:result.authenticated,files:result.files,deleted:retention.deleted,dryRun:retention.dryRun}));
 }finally{
  // Keep failed encrypted input/pending plan for manual exact replay, never private plaintext copies.
  for(const file of ['release.json','consistent.dump','database-evidence.json'])await rm(join(run,file),{force:true});
  if(success){await rm(join(run,'snapshot.yyb'),{force:true});}
 }
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'DAILY_OFFSITE_FAILED');process.exitCode=1;}
