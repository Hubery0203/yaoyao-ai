import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,readdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKey,restoreBackup} from './archive.mjs';
import {createSnapshot} from './snapshot.mjs';
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'snapshot-'));await chmod(root,0o700);try{const c={out:join(root,'out.yyb'),keyFile:join(root,'key')};await createKey(c.keyFile);for(const key of ['dump','apiEnv','weixinAuth','reference','release']){c[key]=join(root,key);await writeFile(c[key],key==='dump'?'PGDMPsynthetic test':'synthetic-'+key,{mode:0o600});}await fn(c,root);}finally{await rm(root,{recursive:true,force:true});}}
test('explicit snapshot authenticates all five inputs without storing the key',()=>fixture(async(c,root)=>{assert.equal((await createSnapshot(c)).configurationCaptured,true);const out=join(root,'restored');assert.equal((await restoreBackup({archive:c.out,keyFile:c.keyFile,out})).files,5);assert.deepEqual((await readdir(out)).sort(),['RESTORED.json','api.env','database.dump','reference.img','release.json','weixin-auth.json']);}));
test('stale/non-custom dump, missing inputs and public credentials are refused',()=>fixture(async(c)=>{await utimes(c.dump,new Date(0),new Date(0));await assert.rejects(createSnapshot(c),/FRESH_DUMP_REQUIRED/);await writeFile(c.dump,'plain dump',{mode:0o600});await assert.rejects(createSnapshot(c),/CUSTOM_DUMP_REQUIRED/);await writeFile(c.dump,'PGDMPtest',{mode:0o600});await chmod(c.apiEnv,0o644);await assert.rejects(createSnapshot(c));await assert.rejects(createSnapshot({...c,dump:undefined}),/EXPLICIT_SNAPSHOT_PATHS_REQUIRED/);}));
