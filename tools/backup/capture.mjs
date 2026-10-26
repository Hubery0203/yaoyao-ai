/** Explicit bounded online capture: pg_dump and content evidence share one exported read-only snapshot. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {open,link,unlink,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {privateParent,privateRead,hashFile} from './offsite.mjs';
import {databaseEvidence} from './database-evidence.mjs';
export const SESSION_SETTINGS="SET statement_timeout='30s'; SET idle_in_transaction_session_timeout='120s'; SET timezone='UTC'; SET datestyle='ISO,YMD'; SET extra_float_digits=3; SET bytea_output='hex';";
function command(c){if(!Array.isArray(c)||!c.length||c.length>30||!c.every(s=>typeof s==='string'&&s.length<1000&&!/[\r\n\0]/.test(s))||!c[0].startsWith('/'))throw Error('EXPLICIT_PG_COMMAND_REQUIRED');return c;}
export async function captureDatabase({psqlCommand,dumpCommand,out,evidenceOut,maxBytes=48*1024*1024}){
 command(psqlCommand);command(dumpCommand);if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>48*1024*1024||out===evidenceOut)throw Error('CAPTURE_LIMIT');await privateParent(out);await privateParent(evidenceOut);
 for(const p of [out,evidenceOut])try{await lstat(p);throw Error('CAPTURE_OUTPUT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],child=spawn(psqlCommand[0],[...psqlCommand.slice(1),...args],{stdio:['pipe','pipe','pipe']});child.stderr.resume();child.stdin.on('error',()=>{});const lines=createInterface({input:child.stdout}),queue=[],pending=[];let failed=false,timer,dump,f,tmp,committed=false,evidenceCreated=false;
 const reject=()=>{failed=true;for(const x of pending.splice(0))x.bad(Error('CAPTURE_SESSION_FAILED'));};child.once('error',reject);child.once('exit',reject);
 lines.on('line',line=>{if(line.length>2*1024*1024){child.kill('SIGKILL');reject();return;}const item=pending.shift();if(item)item.ok(line);else queue.push(line);});
 const query=async sql=>{if(failed)throw Error('CAPTURE_SESSION_FAILED');const promise=queue.length?Promise.resolve(queue.shift()):new Promise((ok,bad)=>pending.push({ok,bad}));child.stdin.write("SELECT replace(encode(convert_to(coalesce(("+sql+")::text,'null'),'UTF8'),'base64'),E'\\n','');\n");try{return JSON.parse(Buffer.from(await promise,'base64').toString('utf8'));}catch{throw Error('CAPTURE_QUERY_FAILED');}};
 try{
  timer=setTimeout(()=>{child.kill('SIGKILL');dump?.kill('SIGKILL');},120000);
  child.stdin.write(SESSION_SETTINGS+' BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n');
  const snapshot=await query("SELECT to_json(pg_export_snapshot())");if(typeof snapshot!=='string'||!/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{8}-[0-9]+$/.test(snapshot))throw Error('INVALID_EXPORTED_SNAPSHOT');
  const evidence=await databaseEvidence(query);tmp=out+'.'+randomUUID()+'.tmp';f=await open(tmp,'wx',0o600);
  dump=spawn(dumpCommand[0],[...dumpCommand.slice(1),'-Fc','--snapshot='+snapshot],{stdio:['ignore','pipe','pipe']});dump.stderr.resume();let size=0;
  const done=new Promise((ok,bad)=>{dump.once('error',()=>bad(Error('CAPTURE_DUMP_FAILED')));dump.once('close',code=>code===0?ok():bad(Error('CAPTURE_DUMP_FAILED')));});done.catch(()=>{});
  for await(const bytes of dump.stdout){size+=bytes.length;if(size>maxBytes){dump.kill('SIGKILL');throw Error('CAPTURE_LIMIT');}await f.writeFile(bytes);}await done;await f.sync();await f.close();f=null;
  await query('SELECT to_json(true)'); // Ensure the source snapshot remained alive through the dump.
  child.stdin.end('ROLLBACK;\n');const {f:handle,s}=await privateRead(tmp,maxBytes);let digest;try{const magic=Buffer.alloc(5);await handle.read(magic,0,5,0);if(magic.toString()!=='PGDMP')throw Error('CUSTOM_DUMP_REQUIRED');digest=await hashFile(handle,s.size);}finally{await handle.close();}
  const result={...evidence,sharedExportedSnapshot:true,capturedAtUTC:new Date().toISOString(),dumpSHA256:digest,dumpBytes:size,sequenceStateNotMVCC:true};const e=await open(evidenceOut,'wx',0o600);evidenceCreated=true;try{await e.writeFile(JSON.stringify(result,null,2)+'\n');await e.sync();}finally{await e.close();}
  await link(tmp,out);await unlink(tmp);tmp=null;committed=true;return result;
 }finally{clearTimeout(timer);child.stdin.destroy();child.kill('SIGKILL');dump?.kill('SIGKILL');lines.close();await f?.close().catch(()=>{});if(tmp)await unlink(tmp).catch(()=>{});if(!committed&&evidenceCreated)await unlink(evidenceOut).catch(()=>{});}
}
