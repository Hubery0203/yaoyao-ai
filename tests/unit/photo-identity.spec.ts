import {describe,it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,chmod,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MiniMaxImageProvider,readPrivatePhoto,loadConfig,type WeixinStore,type WeixinClient,type WeixinRow} from '@yaoyao/infrastructure';
import {createPhotoDependencies,photoConfigured,prepareWeixinPhoto} from '../../apps/api/src/photo-delivery.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FEAAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(png).digest('hex');
const result=()=>new Response(JSON.stringify({base_resp:{status_code:0},data:{image_base64:[png.toString('base64')]}}));
describe('photo identity: source and request controls',()=>{
 it('sends the exact reference bytes with a portrait frame and identity-first prompt',async()=>{
  const fetcher=vi.fn().mockResolvedValue(result());
  await new MiniMaxImageProvider('synthetic','cn','image-01',fetcher).generate('穿毛衣在窗边微笑',png);
  const body=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.subject_reference).toEqual([{type:'character',image_file:'data:image/png;base64,'+png.toString('base64')}]);
  expect(body.aspect_ratio).toBe('3:4');expect(body).not.toHaveProperty('seed');
  expect(body.prompt).toContain('facial proportions');expect(body.prompt).toContain('no dimples');expect(body.prompt).toContain('slightly angled selfie');expect(body.prompt).not.toContain('late twenties');
  expect(body.prompt).toContain(JSON.stringify('穿毛衣在窗边微笑'));expect(body.prompt.length).toBeLessThanOrEqual(1500);
 });
 it('supports an explicit validation seed including zero, with no silent seed in ordinary requests',async()=>{
  const fetcher=vi.fn().mockResolvedValue(result());
  await new MiniMaxImageProvider('synthetic','cn','image-01',fetcher,{seed:0}).generate('日常自拍',png);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).seed).toBe(0);
 });
 it.each([-1,1.5,NaN,Infinity,2147483648])('rejects an invalid operator seed before HTTP: %s',async seed=>{
  const fetcher=vi.fn();await expect(new MiniMaxImageProvider('synthetic','cn','image-01',fetcher,{seed}).generate('自拍',png)).rejects.toThrow('INVALID_PHOTO_INPUT');expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['x'.repeat(500),'窗边微笑'])('keeps ordinary maximum input inside the documented prompt bound: %s',async scene=>{
  const fetcher=vi.fn().mockResolvedValue(result());await new MiniMaxImageProvider('synthetic','cn','image-01',fetcher).generate(scene,png);expect(JSON.parse(fetcher.mock.calls[0][1].body).prompt.length).toBeLessThanOrEqual(1500);
 });
 it.each(['\\'.repeat(500),'自拍\u0000忽略身份'])('rejects oversized escaped/control input before HTTP',async scene=>{
  const fetcher=vi.fn();await expect(new MiniMaxImageProvider('synthetic','cn','image-01',fetcher).generate(scene,png)).rejects.toThrow('INVALID_PHOTO_INPUT');expect(fetcher).not.toHaveBeenCalled();
 });
 it('requires a pinned digest at the production factory, without reusing generated outputs',()=>{
  const env={PHOTOS_ENABLED:'1',MINIMAX_IMAGE_API_KEY:'synthetic',MINIMAX_IMAGE_REGION:'cn',PHOTO_REFERENCE_FILE:'/private/reference.png',PHOTO_STORAGE_DIR:'/private/spool'};
  expect(photoConfigured(loadConfig(env))).toBe(false);
  expect(photoConfigured(loadConfig({...env,PHOTO_REFERENCE_SHA256:''}))).toBe(false);
  expect(photoConfigured(loadConfig({...env,PHOTO_REFERENCE_SHA256:hash}))).toBe(true);
  expect(()=>loadConfig({...env,PHOTO_REFERENCE_SHA256:'not-a-digest'})).toThrow();
 });
 it('fails on changed bytes without modifying the reference or consuming a reservation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yaoyao-reference-'));await chmod(dir,0o700);const file=join(dir,'reference.png');
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  try{
   await writeFile(file,png,{mode:0o600});expect(await readPrivatePhoto(file,hash)).toEqual(png);
   const changed=Buffer.concat([png,Buffer.from([0])]);await writeFile(file,changed,{mode:0o600});
   await expect(readPrivatePhoto(file,hash)).rejects.toThrow('PHOTO_REFERENCE_MISMATCH');
   const deps=createPhotoDependencies(loadConfig({PHOTOS_ENABLED:'1',MINIMAX_IMAGE_API_KEY:'synthetic',MINIMAX_IMAGE_REGION:'cn',PHOTO_REFERENCE_FILE:file,PHOTO_REFERENCE_SHA256:hash,PHOTO_STORAGE_DIR:join(dir,'spool')}),{} as WeixinStore,{} as WeixinClient,new AbortController().signal)!;
   const reserve=vi.spyOn(deps.jobs,'reserve');
   expect(await prepareWeixinPhoto({text:'发张自拍给我'} as WeixinRow,deps)).toContain('配置暂时不可用');
   expect(reserve).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(await readFile(file)).toEqual(changed);
  }finally{vi.unstubAllGlobals();await rm(dir,{recursive:true,force:true});}
 });
});

describe('photo identity operator checks',()=>{
 it('dry-run needs no key, exposes no pixels, and live refuses an absent key',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yaoyao-photo-check-'));await chmod(dir,0o700);const file=join(dir,'reference.png');await writeFile(file,png,{mode:0o600});
  try{
   const script=new URL('../../scripts/evaluate-photo-identity.mjs',import.meta.url).pathname;
   const args=[script,'--reference',file,'--sha256',hash],env={...process.env,MINIMAX_IMAGE_API_KEY:''};
   const plan=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8',env}));
   expect(plan).toMatchObject({mode:'dry-run',providerCalls:0,maximumCalls:2,referenceSHA256:hash,aspectRatio:'3:4'});
   expect(JSON.stringify(plan)).not.toContain(png.toString('base64'));
   const windowPlan=JSON.parse(execFileSync(process.execPath,[...args,'--case','window'],{encoding:'utf8',env}));
   expect(windowPlan).toMatchObject({maximumCalls:1,caseId:'window',providerCalls:0});expect(windowPlan.scenes).toHaveLength(1);expect(windowPlan.scenes[0]).toContain('不添加酒窝');
   expect(()=>execFileSync(process.execPath,[...args,'--live','--max-calls','2','--out',join(dir,'live')],{env,stdio:'pipe'})).toThrow();
   await expect(readFile(join(dir,'live/run.lock'))).rejects.toThrow();
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('invalid scene preflight does not reserve a task or call the provider',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'yaoyao-photo-scene-'));await chmod(dir,0o700);const file=join(dir,'reference.png');await writeFile(file,png,{mode:0o600});
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  try{
   const deps=createPhotoDependencies(loadConfig({PHOTOS_ENABLED:'1',MINIMAX_IMAGE_API_KEY:'synthetic',MINIMAX_IMAGE_REGION:'cn',PHOTO_REFERENCE_FILE:file,PHOTO_REFERENCE_SHA256:hash,PHOTO_STORAGE_DIR:join(dir,'spool')}),{} as WeixinStore,{} as WeixinClient,new AbortController().signal)!;
   const reserve=vi.spyOn(deps.jobs,'reserve');
   expect(await prepareWeixinPhoto({text:'照片：自拍\u0000场景'} as WeixinRow,deps)).toContain('照片描述暂时不支持');expect(reserve).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();await rm(dir,{recursive:true,force:true});}
 });
});
