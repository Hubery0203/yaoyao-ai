#!/usr/bin/env node
/** Operator-only ASR check: offline by default; exactly one fenced live request. */
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {isAbsolute,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{MiniMaxAsrProvider,inspectAsrWav}=require('../core/infrastructure/dist/index.js');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),allowed=new Set(['--audio','--out','--max-calls','--live']),flags=new Map();
for(let i=0;i<args.length;i++){const k=args[i];if(!allowed.has(k)||flags.has(k))throw Error('INVALID_ARGUMENT');if(k==='--live')flags.set(k,true);else{if(i+1>=args.length||args[i+1].startsWith('--'))throw Error('MISSING_ARGUMENT');flags.set(k,args[++i]);}}
const audio=flags.get('--audio');if(typeof audio!=='string'||!isAbsolute(audio))throw Error('ABSOLUTE_AUDIO_REQUIRED');
const st=lstatSync(audio);if(!st.isFile()||st.isSymbolicLink()||st.mode&0o077||st.size>2*1024*1024+44)throw Error('PRIVATE_BOUNDED_AUDIO_REQUIRED');
const bytes=readFileSync(audio),info=inspectAsrWav(bytes),live=flags.has('--live'),record={version:'voice-input-v1',mode:live?'live':'dry-run',audioSHA256:createHash('sha256').update(bytes).digest('hex'),...info,maximumCalls:live?1:0,requestsStarted:0,weixinMessagesSent:0,deployments:0,atUTC:new Date().toISOString()};
if(!live){console.log(JSON.stringify(record));process.exit(0);}
if(flags.get('--max-calls')!=='1')throw Error('EXPLICIT_ONE_CALL_LIMIT_REQUIRED');
if(!process.env.MINIMAX_ASR_API_KEY?.trim()||!['cn','international'].includes(process.env.MINIMAX_ASR_REGION))throw Error('EXPLICIT_ASR_CREDENTIALS_REQUIRED');
if(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).trim())throw Error('CLEAN_SOURCE_REQUIRED');
record.tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim();
const out=flags.get('--out');if(typeof out!=='string'||!isAbsolute(out)||resolve(out)!==out)throw Error('ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
try{mkdirSync(out,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
const dir=lstatSync(out);if(!dir.isDirectory()||dir.isSymbolicLink()||dir.mode&0o077||realpathSync(out)!==out)throw Error('PRIVATE_OUTPUT_REQUIRED');
function save(){const fd=openSync(resolve(out,'ledger.json'),'w',0o600);try{writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
const fd=openSync(resolve(out,'run.lock'),'wx',0o600);try{writeFileSync(fd,'One authorized ASR request only; never remove this fence to retry.\n');fsyncSync(fd);}finally{closeSync(fd);}
record.requestsStarted=1;record.state='started';save();
try{record.result=await new MiniMaxAsrProvider(process.env.MINIMAX_ASR_API_KEY,process.env.MINIMAX_ASR_REGION).transcribe(bytes);record.state='succeeded';save();console.log(JSON.stringify({state:record.state,requestsStarted:record.requestsStarted,ledger:resolve(out,'ledger.json')}));}
catch(e){record.state='failed-or-unknown';record.failureCode=/^ASR_[A-Z_]+$/.test(e.code??'')?e.code:'ASR_RESULT_UNKNOWN';save();console.error(record.failureCode+'; no retry authorized by this tool');process.exitCode=1;}
