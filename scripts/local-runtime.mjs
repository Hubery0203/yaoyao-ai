/** Native local runtime: private PostgreSQL cluster, migrations and loopback services. */
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod,open,access,unlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {Pool} from 'pg';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(process.env.YAOYAO_LOCAL_DIR||join(repo,'.local'));
const cfgPath=join(dir,'runtime.json');
await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
const action=process.argv[2]||'status';
const pgBin=process.env.PG_BIN||join(dir,'Postgres.app/Contents/Versions/16/bin');
const cluster=join(dir,'pgdata');
let cfg;
try{cfg=JSON.parse(await readFile(cfgPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;cfg={pgPort:55432,apiPort:4300,webPort:4174,adminPassword:randomBytes(32).toString('hex'),appPassword:randomBytes(32).toString('hex'),jwtSecret:randomBytes(48).toString('hex'),owners:[]};await save();}
async function save(){await writeFile(cfgPath,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});await chmod(cfgPath,0o600);}
function command(file,args,env=process.env){const r=spawnSync(file,args,{env,encoding:'utf8'});if(r.status!==0)throw new Error(`${file.split('/').pop()} failed (${r.status}): ${(r.stderr||'').slice(0,250)}`);return r.stdout;}
function pgRunning(){return spawnSync(join(pgBin,'pg_ctl'),['-D',cluster,'status'],{stdio:'ignore'}).status===0;}
function pool(database='yaoyao'){return new Pool({host:'127.0.0.1',port:cfg.pgPort,database,user:'yaoyao_admin',password:cfg.adminPassword});}
async function init(){
 await access(join(pgBin,'postgres'));
 try{await access(join(cluster,'PG_VERSION'));}catch(e){if(e.code!=='ENOENT')throw e;const pw=join(dir,'init-password');await writeFile(pw,cfg.adminPassword+'\n',{mode:0o600});try{command(join(pgBin,'initdb'),['-D',cluster,'-U','yaoyao_admin','--pwfile='+pw,'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{await unlink(pw);}}
 if(!pgRunning()){await mkdir(join(dir,'socket'),{recursive:true,mode:0o700});command(join(pgBin,'pg_ctl'),['-D',cluster,'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${cfg.pgPort} -k ${join(dir,'socket')}`,'-w','start']);}
 const admin=pool('postgres');try{const exists=await admin.query("SELECT 1 FROM pg_database WHERE datname='yaoyao'");if(!exists.rowCount)await admin.query('CREATE DATABASE yaoyao');}finally{await admin.end();}
 const db=pool();try{const {applyMigrations}=await import('@yaoyao/infrastructure');const result=await applyMigrations(db,join(repo,'db/migrations'),'local-runtime');await db.query("ALTER ROLE yaoyao_app WITH LOGIN PASSWORD '"+cfg.appPassword+"'");console.log(JSON.stringify({database:'ready',applied:result.applied,existing:result.alreadyApplied}));}finally{await db.end();}
}
async function providerEnv(){let data;try{data=parseEnv(await readFile(join(dir,'deepseek.env'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;data={};}if(!data.DEEPSEEK_API_KEY?.trim())throw new Error('Fill DEEPSEEK_API_KEY in the private local deepseek.env file before starting');return {DEEPSEEK_API_KEY:data.DEEPSEEK_API_KEY.trim(),DEEPSEEK_MODEL:data.DEEPSEEK_MODEL||'deepseek-flash'};}
async function readProcess(name){try{return JSON.parse(await readFile(join(dir,name+'.pid.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function sameProcess(record){if(!record)return false;try{process.kill(record.pid,0);}catch{return false;}const args=spawnSync('ps',['-p',String(record.pid),'-o','command='],{encoding:'utf8'}).stdout||'';return args.includes(record.script)&&args.includes(process.execPath);}
async function startProcess(name,script,env){const record=await readProcess(name);if(sameProcess(record)){console.log(name+': already running');return;}const log=await open(join(dir,name+'.log'),'a',0o600);try{const child=spawn(process.execPath,[script],{cwd:repo,env,detached:true,stdio:['ignore',log.fd,log.fd]});await new Promise((ok,no)=>{child.once('spawn',ok);child.once('error',no);});child.unref();await writeFile(join(dir,name+'.pid.json'),JSON.stringify({pid:child.pid,script}),{mode:0o600});console.log(name+': started');}finally{await log.close();}}
async function stopProcess(name){const record=await readProcess(name);if(!sameProcess(record))return;process.kill(record.pid,'SIGTERM');for(let i=0;i<50;i++){if(!sameProcess(record))return;await new Promise(r=>setTimeout(r,100));}throw new Error(name+' did not stop; no forced termination performed');}
async function status(){const result={database:pgRunning(),api:false,worker:sameProcess(await readProcess('worker')),web:false};for(const [name,url] of [['api',`http://127.0.0.1:${cfg.apiPort}/health/ready`],['web',`http://127.0.0.1:${cfg.webPort}/`]]){try{const response=await fetch(url,{signal:AbortSignal.timeout(3000)});result[name]=response.ok;if(name==='api'&&response.ok){const health=await response.json();result[name]=health.checks?.some(c=>c.name==='database'&&c.status==='ok')===true;}}catch{}}console.log(JSON.stringify(result));}
async function start(){const provider=await providerEnv();await init();const env={...process.env,...provider,NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(cfg.apiPort),DATABASE_URL:`postgres://yaoyao_app:${cfg.appPassword}@127.0.0.1:${cfg.pgPort}/yaoyao`,JWT_ACCESS_SECRET:cfg.jwtSecret,CONTINUITY_USER_IDS:cfg.owners.join(','),CONTINUITY_POLL_MS:'2000',LLM_L1_PROVIDER:'deepseek',LLM_L2_PROVIDER:'deepseek',LLM_L3_PROVIDER:'deepseek',LLM_FALLBACK_PROVIDER:'deepseek'};await startProcess('api',join(repo,'apps/api/dist/main.js'),env);await startProcess('worker',join(repo,'apps/worker/dist/main.js'),env);await startProcess('web',join(repo,'apps/web/server.mjs'),{...process.env,WEB_PORT:String(cfg.webPort),YAOYAO_API_URL:`http://127.0.0.1:${cfg.apiPort}`});for(let attempt=0;attempt<40;attempt++){try{const response=await fetch(`http://127.0.0.1:${cfg.apiPort}/health/ready`,{signal:AbortSignal.timeout(1000)});const health=await response.json();const web=await fetch(`http://127.0.0.1:${cfg.webPort}/`,{signal:AbortSignal.timeout(1000)});if(response.ok&&web.ok&&health.checks?.some(c=>c.name==='database'&&c.status==='ok')&&sameProcess(await readProcess('api'))&&sameProcess(await readProcess('worker'))&&sameProcess(await readProcess('web'))){console.log(`Ready: http://127.0.0.1:${cfg.webPort}`);return;}}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error('Services did not become ready; inspect the private API/worker/web logs in the local runtime directory');}
try{
 if(action==='init')await init();
 else if(action==='start')await start();
 else if(action==='stop'){for(const name of ['web','worker','api'])await stopProcess(name);if(pgRunning())command(join(pgBin,'pg_ctl'),['-D',cluster,'-m','fast','-w','stop']);console.log('Local runtime stopped; data retained.');}
 else if(action==='restart'){for(const name of ['web','worker','api'])await stopProcess(name);await start();}
 else if(action==='add-owner'){const id=process.argv[3];if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id||''))throw new Error('Provide the account UUID from settings');if(!cfg.owners.includes(id)){if(cfg.owners.length>=100)throw new Error('Owner limit reached');cfg.owners.push(id);await save();}console.log('Owner saved; restart to activate the worker for this account.');}
 else if(action==='backup'){if(!pgRunning())throw new Error('Start the local database before backup');const folder=join(dir,'backups');await mkdir(folder,{recursive:true,mode:0o700});const file=join(folder,'yaoyao-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');command(join(pgBin,'pg_dump'),['-h','127.0.0.1','-p',String(cfg.pgPort),'-U','yaoyao_admin','-d','yaoyao','-Fc','-f',file],{...process.env,PGPASSWORD:cfg.adminPassword});await chmod(file,0o600);console.log('Backup saved: '+file);}
 else if(action==='status')await status();
 else throw new Error('Use init, start, stop, restart, status, backup or add-owner UUID');
}catch(error){console.error(error.message);process.exitCode=1;}
