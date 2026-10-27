#!/usr/bin/env node
/** Operator-only image understanding check. Default is offline; one explicit request, no retry/send. */
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {isAbsolute,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {MiniMaxVisionProvider,inspectVisionImage,visionPrompt,VISION_PROMPT_VERSION}=require('../core/infrastructure/dist/index.js');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),allowed=new Set(['--image','--caption','--out','--max-calls','--live']);
const flags=new Map();for(let i=0;i<args.length;i++){const k=args[i];if(!allowed.has(k)||flags.has(k))throw Error('INVALID_ARGUMENT');if(k==='--live')flags.set(k,true);else{if(i+1>=args.length||args[i+1].startsWith('--'))throw Error('MISSING_ARGUMENT');flags.set(k,args[++i]);}}
const image=flags.get('--image');if(typeof image!=='string'||!isAbsolute(image))throw Error('ABSOLUTE_IMAGE_REQUIRED');
const st=lstatSync(image);if(!st.isFile()||st.isSymbolicLink()||st.mode&0o077||st.size>4*1024*1024)throw Error('PRIVATE_BOUNDED_IMAGE_REQUIRED');
const bytes=readFileSync(image),info=inspectVisionImage(bytes),caption=flags.get('--caption')??'';visionPrompt(caption,[]);
const live=flags.has('--live'),record={version:VISION_PROMPT_VERSION,mode:live?'live':'dry-run',imageSHA256:createHash('sha256').update(bytes).digest('hex'),...info,maximumCalls:live?1:0,requestsStarted:0,networkCalls:0,weixinMessagesSent:0,deployments:0,atUTC:new Date().toISOString()};
if(!live){console.log(JSON.stringify(record));process.exit(0);}
if(flags.get('--max-calls')!=='1')throw Error('EXPLICIT_ONE_CALL_LIMIT_REQUIRED');
if(!process.env.MINIMAX_VISION_API_KEY?.trim()||!['cn','international'].includes(process.env.MINIMAX_VISION_REGION))throw Error('EXPLICIT_VISION_CREDENTIALS_REQUIRED');
const status=execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'});if(status.trim())throw Error('CLEAN_SOURCE_REQUIRED');
record.tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim();
const out=flags.get('--out');if(typeof out!=='string'||!isAbsolute(out)||resolve(out)!==out)throw Error('ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
try{mkdirSync(out,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
const dir=lstatSync(out);if(!dir.isDirectory()||dir.isSymbolicLink()||dir.mode&0o077||realpathSync(out)!==out)throw Error('PRIVATE_OUTPUT_REQUIRED');
function save(){const fd=openSync(resolve(out,'ledger.json'),'w',0o600);try{writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
const fd=openSync(resolve(out,'run.lock'),'wx',0o600);try{writeFileSync(fd,'One authorized vision request only; never delete this fence to retry.\n');fsyncSync(fd);}finally{closeSync(fd);}
record.requestsStarted=1;record.state='started';save();
try{record.reply=await new MiniMaxVisionProvider(process.env.MINIMAX_VISION_API_KEY,process.env.MINIMAX_VISION_REGION).understand(bytes,caption,[]);record.networkCalls=1;record.state='succeeded';save();console.log(JSON.stringify({state:record.state,requestsStarted:record.requestsStarted,ledger:resolve(out,'ledger.json')}));}
catch(e){record.state='failed-or-unknown';record.failureCode=/^VISION_[A-Z_]+$/.test(e.code??'')?e.code:'VISION_RESULT_UNKNOWN';record.failureReason=['MISSING_BODY','RESPONSE_TOO_LARGE','NON_JSON','CONTENT_TYPE','EMPTY_CONTENT','CONTENT_TOO_LONG','CONTROL_CHARACTERS','UNSAFE_REPLY'].includes(e.reason)?e.reason:null;record.networkCalls=1;save();console.error(record.failureCode+(record.failureReason?':'+record.failureReason:'')+'; no retry authorized by this tool');process.exitCode=1;}
