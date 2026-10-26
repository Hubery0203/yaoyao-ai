#!/usr/bin/env node
import {readPrivateJson} from './offsite.mjs';
import {createSnapshot} from './snapshot.mjs';
try{
 if(process.argv.length!==4||process.argv[2]!=='--config')throw Error('USAGE_PRIVATE_SNAPSHOT_CONFIG');
 const config=await readPrivateJson(process.argv[3]);console.log(JSON.stringify(await createSnapshot(config)));
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'SNAPSHOT_FAILED');process.exitCode=1;}
