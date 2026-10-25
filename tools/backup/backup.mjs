#!/usr/bin/env node
import {createKey,encryptBackup,restoreBackup,readBackupPlan} from './archive.mjs';
const [command,...args]=process.argv.slice(2);const flag=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
try{
 let result;if(command==='key')result=await createKey(flag('--out'));
 else if(command==='encrypt'){const manifest=await readBackupPlan(flag('--manifest'));result=await encryptBackup({entries:manifest.entries,keyFile:flag('--key-file'),out:flag('--out')});}
 else if(command==='restore')result=await restoreBackup({archive:flag('--archive'),keyFile:flag('--key-file'),out:flag('--out')});
 else throw Error('USAGE_KEY_ENCRYPT_OR_RESTORE');
 console.log(JSON.stringify(result));
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'BACKUP_OPERATION_FAILED');process.exitCode=1;}
