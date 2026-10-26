/** Explicit fresh-dump snapshot. Does not discover credentials, call docker, or touch live DBs. */
import {mkdtemp,open,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {privateParent,privateRead} from './offsite.mjs';
import {encryptBackup} from './archive.mjs';
export async function createSnapshot({dump,apiEnv,weixinAuth,reference,release,keyFile,out,now=new Date()}){
 await privateParent(out);let workspace;const sources=[];
 try{
  const key=await privateRead(keyFile,32);const keyStat=key.s;await key.f.close();
  workspace=await mkdtemp(join(dirname(out),'.snapshot-'));const entries=[];let total=0;
  for(const [name,path]of Object.entries({'database.dump':dump,'api.env':apiEnv,'weixin-auth.json':weixinAuth,'reference.img':reference,'release.json':release})){
   if(typeof path!=='string')throw Error('EXPLICIT_SNAPSHOT_PATHS_REQUIRED');await privateParent(path);const {f,s}=await privateRead(path,48*1024*1024);sources.push(f);if(s.dev===keyStat.dev&&s.ino===keyStat.ino)throw Error('KEY_MUST_BE_STORED_SEPARATELY');total+=s.size;if(total>48*1024*1024)throw Error('SNAPSHOT_LIMIT');
   if(name==='database.dump'){
    const magic=Buffer.alloc(5);await f.read(magic,0,5,0);if(magic.toString()!=='PGDMP')throw Error('CUSTOM_DUMP_REQUIRED');
    const age=now.getTime()-s.mtimeMs;if(age<0||age>3600000)throw Error('FRESH_DUMP_REQUIRED');
   }
   const destPath=join(workspace,name),dest=await open(destPath,'wx',0o600);
   try{let at=0;while(at<s.size){const b=Buffer.alloc(Math.min(65536,s.size-at)),r=await f.read(b,0,b.length,at);if(!r.bytesRead)throw Error('SOURCE_TRUNCATED');at+=r.bytesRead;await dest.writeFile(b.subarray(0,r.bytesRead));}await dest.sync();}finally{await dest.close();}
   const after=await f.stat();if(after.size!==s.size||after.mtimeMs!==s.mtimeMs||after.ctimeMs!==s.ctimeMs)throw Error('SNAPSHOT_SOURCE_CHANGED');
   entries.push({name,path:destPath});
  }
  const result=await encryptBackup({entries,keyFile,out,maxBytes:48*1024*1024});return {...result,liveDatabaseTouched:false,configurationCaptured:true,databaseConsistency:'pg_dump snapshot; operator must serialize deployment and credential rotation'};
 }finally{for(const f of sources)await f.close();if(workspace)await rm(workspace,{recursive:true,force:true});}
}
