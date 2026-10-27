/** Operator-only, at most two image calls; dry-run is the default. Never sends to Weixin. */
import {open,mkdir,lstat,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MiniMaxImageProvider,MINIMAX_PHOTO_PROMPT_VERSION} from '../core/infrastructure/dist/photos/minimax-image.js';
import {readPrivatePhoto,imageMime} from '../core/infrastructure/dist/photos/files.js';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const live=process.argv.includes('--live'),referencePath=arg('--reference'),digest=arg('--sha256'),seed=Number(arg('--seed')??20261027),out=arg('--out');
const scenes=['书桌旁的自然手机自拍，正面微笑，面部清晰','穿米色针织衫，在窗边自然微笑的半身自拍'];
if(!referencePath||!digest||!Number.isSafeInteger(seed)||seed<0||seed>2147483647)throw Error('REFERENCE_HASH_AND_VALID_SEED_REQUIRED');
const reference=await readPrivatePhoto(referencePath,digest),repo=fileURLToPath(new URL('..',import.meta.url));
const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:repo,encoding:'utf8'}).trim();
const clean=!execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim();
const plan={version:'photo-identity-v1',promptVersion:MINIMAX_PHOTO_PROMPT_VERSION,tree,clean,referenceSHA256:digest,referenceBytes:reference.length,seed,aspectRatio:'3:4',scenes,maximumCalls:2,method:'Two candidate-only scenes, original reference bytes, one image each. Seed aids comparison, not an identity guarantee. Manual owner review required; no Weixin writes.'};
if(!live){console.log(JSON.stringify({...plan,mode:'dry-run',providerCalls:0}));process.exit(0);}
if(!clean||arg('--max-calls')!=='2'||!out||!isAbsolute(out)||!process.env.MINIMAX_IMAGE_API_KEY||!['cn','international'].includes(process.env.MINIMAX_IMAGE_REGION))throw Error('EXPLICIT_LIVE_BUDGET_PRIVATE_KEY_REGION_OUTPUT_AND_CLEAN_TREE_REQUIRED');
await mkdir(out,{recursive:true,mode:0o700});const stat=await lstat(out);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.mode&0o077)throw Error('PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
const provider=new MiniMaxImageProvider(process.env.MINIMAX_IMAGE_API_KEY,process.env.MINIMAX_IMAGE_REGION,'image-01',fetch,{seed});
for(const scene of scenes)provider.validate(scene,reference);
// Durable single-run fence. Never remove or recreate it to obtain more calls.
const lock=await open(join(out,'run.lock'),'wx',0o600);await lock.writeFile(JSON.stringify(plan));await lock.sync();await lock.close();
const ledger={...plan,mode:'live',atUTC:new Date().toISOString(),attempts:[],ownerReview:'pending'};
async function save(){const file=join(out,'ledger.tmp');const f=await open(file,'wx',0o600);try{await f.writeFile(JSON.stringify(ledger,null,2)+'\n');await f.sync();}finally{await f.close();}await rename(file,join(out,'ledger.json'));}
for(const [index,scene]of scenes.entries()){
 if(ledger.attempts.length>=2)throw Error('IMAGE_BUDGET_EXHAUSTED');
 const attempt={number:index+1,scene,state:'started',startedAtUTC:new Date().toISOString()};ledger.attempts.push(attempt);await save();
 try{
  const bytes=await provider.generate(scene,reference),mime=imageMime(bytes),file='candidate-'+(index+1)+(mime==='image/png'?'.png':'.jpg');
  const f=await open(join(out,file),'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
  Object.assign(attempt,{state:'succeeded',file,mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});await save();
  console.log(JSON.stringify({number:attempt.number,state:attempt.state,file,bytes:bytes.length}));
 }catch(e){attempt.state='failed_or_unknown';attempt.failureCode=/^PHOTO_[A-Z_]+$/.test(e.code??e.message)?(e.code??e.message):'PHOTO_RESULT_UNKNOWN';await save();process.exitCode=1;console.log(JSON.stringify({number:attempt.number,state:attempt.state,failureCode:attempt.failureCode}));break;}
}
