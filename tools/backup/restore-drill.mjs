#!/usr/bin/env node
/** Offline disposable PostgreSQL drill. Never starts API/Weixin, never uses a TCP port. */
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,lstat,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readPrivateJson,privateParent} from './offsite.mjs';
import {restoreBackup} from './archive.mjs';
import {databaseEvidence,compareEvidence,validateSequenceFloors,extensionBootstrap} from './database-evidence.mjs';
import {privateRead,hashFile} from './offsite.mjs';
export async function restoreDrill(c){
 if(typeof c.pgBin!=='string'||!c.pgBin.startsWith('/')||typeof c.workspace!=='string')throw Error('EXPLICIT_DRILL_CONFIG_REQUIRED');
 await privateParent(join(c.workspace,'probe'));const ws=await lstat(c.workspace);if(!ws.isDirectory()||ws.isSymbolicLink())throw Error('PRIVATE_WORKSPACE_REQUIRED');
 // Socket paths must be short enough for PostgreSQL on macOS/Linux.
 const run=await mkdtemp(join(c.workspace,'drill-')),data=join(run,'pgdata'),socket=join(run,'socket'),out=join(run,'restored');let started=false;
 const invoke=(bin,args,input)=>execFileSync(join(c.pgBin,bin),args,{input,stdio:['pipe','pipe','pipe'],timeout:60000,maxBuffer:8*1024*1024,env:{PATH:process.env.PATH,LANG:'C',HOME:run}}).toString();
 try{
  await restoreBackup({archive:c.archive,keyFile:c.keyFile,out});await mkdir(socket,{mode:0o700});if(socket.length>80)throw Error('SOCKET_PATH_TOO_LONG');
  invoke('initdb',['-D',data,'-U','drill_admin','--auth-local=trust','--auth-host=reject','--no-locale','--encoding=UTF8']);
  started=true;invoke('pg_ctl',['-D',data,'-l',join(run,'postgres.log'),'-o',`-h '' -k '${socket.replace(/'/g,"'\\''")}' -p 5432 -c shared_buffers=16MB -c max_connections=10 -c jit=off`,'-w','-t','15','start']);
  const connection=['-h',socket,'-p','5432','-U','drill_admin'];
  const sql=q=>invoke('psql',[...connection,'-d','yaoyao_drill','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',q]);
  invoke('createdb',[...connection,'yaoyao_drill']);
  sql('CREATE ROLE postgres NOLOGIN; CREATE ROLE yaoyao_admin NOLOGIN; CREATE ROLE yaoyao_migrate NOLOGIN; CREATE ROLE yaoyao_app NOLOGIN; CREATE ROLE yaoyao_readonly NOLOGIN; CREATE ROLE yaoyao_breakglass NOLOGIN;');
  const source=JSON.parse(await readFile(join(out,'release.json'),'utf8')).backupEvidence;
  for(const statement of extensionBootstrap(source?.extensionVersions??c.expectedExtensionVersions))sql(statement);
  invoke('pg_restore',[...connection,'--dbname=yaoyao_drill','--exit-on-error',join(out,'database.dump')]);
  sql("SET timezone='UTC'; SET datestyle='ISO,YMD'; SET extra_float_digits=3; SET bytea_output='hex';");
  // psql invocations are separate sessions, so pin formatting on every evidence query.
  const evidenceQuery=q=>JSON.parse(sql("SET timezone='UTC'; SET datestyle='ISO,YMD'; SET extra_float_digits=3; SET bytea_output='hex'; SELECT coalesce(("+q+")::text,'null')"));
  const sequenceCheck=await validateSequenceFloors(evidenceQuery);
  let contentCompared=false;
  if(c.requireContentEvidence===true&&!source)throw Error('SOURCE_CONTENT_EVIDENCE_REQUIRED');
  if(source){const {f,s}=await privateRead(join(out,'database.dump'),48*1024*1024);try{if(await hashFile(f,s.size)!==source.dumpSHA256)throw Error('DUMP_EVIDENCE_MISMATCH');}finally{await f.close();}compareEvidence(source,await databaseEvidence(evidenceQuery));contentCompared=true;}
  const tables=JSON.parse(sql("SELECT coalesce(json_agg(json_build_object('name',tablename,'rls',rowsecurity) ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public'"));
  if(!tables.some(t=>t.name==='schema_migrations')||!tables.some(t=>t.name==='weixin_channels'))throw Error('EXPECTED_SCHEMA_MISSING');
  const counts=[];for(const t of tables){if(!/^[a-z_][a-z0-9_]*$/.test(t.name))throw Error('UNEXPECTED_TABLE_NAME');counts.push({name:t.name,count:Number(sql('SELECT count(*) FROM public."'+t.name+'"'))});}
  const policies=sql("SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname");
  const sequences=sql("SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename");
  const migrations=sql('SELECT version,checksum FROM schema_migrations ORDER BY version');
  const ownerIds=sql('SELECT user_id::text FROM users ORDER BY user_id LIMIT 2').split('\n').filter(Boolean);let ownerIsolationVerified=false;
  if(ownerIds.length===2){for(const owner of ownerIds){if(!/^[a-f0-9-]{36}$/.test(owner))throw Error('UNEXPECTED_OWNER_ID');const check=JSON.parse(sql("BEGIN READ ONLY; SET LOCAL ROLE yaoyao_app; SET LOCAL app.user_id='"+owner+"'; SELECT json_build_object('own',count(*) FILTER(WHERE user_id='"+owner+"'::uuid),'other',count(*) FILTER(WHERE user_id<>'"+owner+"'::uuid)) FROM users; ROLLBACK;"));if(check.own!==1||check.other!==0)throw Error('RESTORED_OWNER_ISOLATION_FAILED');}ownerIsolationVerified=true;}
  const fingerprint=createHash('sha256').update(JSON.stringify({tables,counts,policies,sequences,migrations})).digest('hex');
  const result={restored:true,isolatedCluster:true,tcpListening:false,apiStarted:false,weixinStarted:false,tableCount:tables.length,rows:counts.reduce((n,t)=>n+t.count,0),metadataAndCountsFingerprint:fingerprint,ownerIsolationVerified,ownerIsolationUsersTested:ownerIds.length,sequenceFloorsVerified:sequenceCheck.safe,sequenceCount:sequenceCheck.sequences,contentDigestsCompared:contentCompared,sourceFingerprintCompared:typeof c.expectedFingerprint==='string',sourceFingerprintMatches:c.expectedFingerprint?fingerprint===c.expectedFingerprint:null,productionTouched:false};
  if(c.expectedFingerprint&&result.sourceFingerprintMatches!==true)throw Error('SOURCE_FINGERPRINT_MISMATCH');
  await writeFile(join(run,'DRILL.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
 }finally{
  if(started){let running=false;try{invoke('pg_ctl',['-D',data,'status']);running=true;}catch{/* Not started or already stopped. */}if(running)invoke('pg_ctl',['-D',data,'-m','fast','-w','-t','15','stop']);}
  // Only this newly-created drill tree is disposable; original ciphertext/key never touched.
  if(c.keepWorkspace!==true)await rm(run,{recursive:true,force:true});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 try{if(process.argv.length!==4||process.argv[2]!=='--config')throw Error('USAGE_PRIVATE_DRILL_CONFIG');console.log(JSON.stringify(await restoreDrill(await readPrivateJson(process.argv[3]))));}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'RESTORE_DRILL_FAILED');process.exitCode=1;}
}
