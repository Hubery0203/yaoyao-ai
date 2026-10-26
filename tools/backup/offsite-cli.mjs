#!/usr/bin/env node
import {readPrivateJson,privateRead,hashFile,objectName,publishBackup,verifyStoredBackup,retainBackups} from './offsite.mjs';
import {SshRepository} from './ssh-repository.mjs';
const [command,...argv]=process.argv.slice(2);
try{
 const allowed={init:['config'],publish:['config','archive','key-file','receipt','name'],verify:['config','receipt','key-file','out'],retain:['config','receipt','keep','apply']};
 if(!Object.hasOwn(allowed,command))throw Error('USAGE_INIT_PUBLISH_VERIFY_RETAIN');
 const flags={};for(let i=0;i<argv.length;i++){const k=argv[i].slice(2);if(!argv[i].startsWith('--')||!allowed[command].includes(k)||Object.hasOwn(flags,k))throw Error('INVALID_ARGUMENTS');if(k==='apply')flags[k]=true;else{if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('MISSING_ARGUMENT');flags[k]=argv[++i];}}
 const repository=new SshRepository(await readPrivateJson(flags.config));let result;
 if(command==='init')result=await repository.init();
 if(command==='publish'){
  let name=flags.name;if(!name){const {f,s}=await privateRead(flags.archive);try{name=objectName(await hashFile(f,s.size));}finally{await f.close();}}
  result=await publishBackup({repository,archive:flags.archive,keyFile:flags['key-file'],name,receipt:flags.receipt});
 }
 if(command==='verify')result=await verifyStoredBackup({repository,receipt:flags.receipt,keyFile:flags['key-file'],out:flags.out});
 if(command==='retain')result=await retainBackups({repository,receipt:flags.receipt,keep:flags.keep===undefined?7:Number(flags.keep),apply:flags.apply===true});
 console.log(JSON.stringify(result));
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'OFFSITE_OPERATION_FAILED');process.exitCode=1;}
