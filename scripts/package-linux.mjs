/** CI-only deployable Linux artifact; includes no operator configuration. */
import {cp,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
if(process.platform!=='linux'||process.arch!=='x64')throw new Error('Build on Linux x64');
const out=resolve('release');await mkdir(out,{recursive:true});
for(const path of ['package.json','package-lock.json','core','apps','db','deploy','node_modules'])await cp(path,resolve(out,path),{recursive:true,verbatimSymlinks:true});
await mkdir(resolve(out,'bin'),{recursive:true});await cp(process.execPath,resolve(out,'bin/node'));
await writeFile(resolve(out,'RELEASE.json'),JSON.stringify({sha:process.env.GITHUB_SHA,platform:process.platform,arch:process.arch,node:process.version}));
execFileSync('tar',['-czf','yaoyao-linux-x64.tar.gz','-C',out,'.']);
