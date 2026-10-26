import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {privateRead,privateParent,validObjectName} from './offsite.mjs';
const fail=c=>{throw Error(c);};
export class SshRepository {
 constructor(config,{launcher=spawn}={}){
  if(!config||config.driver!=='ssh'||typeof config.host!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(config.host)||/[\r\n\0]/.test(config.host)||typeof config.user!=='string'||!/^\w[\w-]{0,31}$/.test(config.user)||/[\r\n\0]/.test(config.user)||!Number.isInteger(config.port)||config.port<1||config.port>65535||typeof config.identityFile!=='string'||!/^\/[^\r\n\0]{1,500}$/.test(config.identityFile)||typeof config.knownHostsFile!=='string'||!/^\/[^\r\n\0]{1,500}$/.test(config.knownHostsFile)||!/[a-f0-9]{32}/.test(config.namespace)||config.namespace.length!==32)fail('INVALID_SSH_REPOSITORY');
  this.config=config;this.launcher=launcher;this.id=createHash('sha256').update(JSON.stringify([config.host,config.user,config.port,config.namespace])).digest('hex');
 }
 async rpc(op,args={},input=null,destination=null,maxBytes=65536){
  if(!['init','put','get','stat','list','delete'].includes(op)||args.name!==undefined&&!validObjectName(args.name))fail('INVALID_REPOSITORY_OPERATION');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)fail('INVALID_TRANSFER_LIMIT');
  const c=this.config;await privateParent(c.identityFile);const key=await privateRead(c.identityFile,65536);await key.f.close();
  const hostFile=await open(c.knownHostsFile,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await hostFile.stat();if(!s.isFile()||s.size>2*1024*1024)fail('INVALID_KNOWN_HOSTS');}finally{await hostFile.close();}
  const request=Buffer.from(JSON.stringify({op,namespace:c.namespace,...args})).toString('base64url');
  const argv=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no','-o','ProxyCommand=none','-o','ProxyJump=none','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=15','-o','UserKnownHostsFile='+c.knownHostsFile,'-i',c.identityFile,'-p',String(c.port),'-l',c.user,'--',c.host,'yaoyao-backup-v1 '+request];
  const child=this.launcher('/usr/bin/ssh',argv,{stdio:['pipe','pipe','pipe']});let timer,bytes=0;const chunks=[];
  const done=new Promise((ok,bad)=>{child.once('error',()=>bad(Error('SSH_TRANSPORT_FAILED')));child.once('close',(code)=>code===0?ok():bad(Error('SSH_OPERATION_FAILED')));});done.catch(()=>{});child.stderr.resume();child.stdin.on('error',()=>{});
  try{
   timer=setTimeout(()=>child.kill('SIGKILL'),900000);
   if(input){input.on('error',()=>child.kill('SIGKILL'));input.pipe(child.stdin);}else child.stdin.end();
   for await(const piece of child.stdout){bytes+=piece.length;if(bytes>maxBytes)fail('REMOTE_OUTPUT_TOO_LARGE');if(destination)await destination.writeFile(piece);else chunks.push(piece);}
   await done;if(destination)return {bytes};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_REPOSITORY_RESPONSE');}
  }finally{clearTimeout(timer);input?.unpipe(child.stdin);child.kill('SIGKILL');}
 }
 init(){return this.rpc('init');}
 put(name,stream,expected){return this.rpc('put',{name,...expected},stream);}
 get(name,dest,{maxBytes}){return this.rpc('get',{name},null,dest,maxBytes);}
 stat(name){return this.rpc('stat',{name});}
 list(){return this.rpc('list');}
 remove(name,sha256){return this.rpc('delete',{name,sha256});}
}
