import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { webServer } from './server.mjs';
test('static pages have CSP, traversal is rejected, proxy preserves auth and retry identity',async()=>{
 const upstream=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,authorization:req.headers.authorization,key:req.headers['idempotency-key'],body}));});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const server=webServer({apiUrl:`http://127.0.0.1:${upstream.address().port}`});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 try{const home=await fetch(url);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await home.text(),/YAOYAO/);assert.equal((await fetch(url+'/package.json')).status,404);
 const reply=await fetch(url+'/api/v1/conversations/messages',{method:'POST',headers:{Authorization:'Bearer test-only','Idempotency-Key':'retry-1','Content-Type':'application/json'},body:'{"text":"hello"}'});const data=await reply.json();assert.equal(data.authorization,'Bearer test-only');assert.equal(data.key,'retry-1');assert.equal(data.body,'{"text":"hello"}');
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>upstream.close(r));}
 assert.throws(()=>webServer({apiUrl:'https://example.com'}),/local/);
});
test('unavailable backend is reported honestly',async()=>{const server=webServer({apiUrl:'http://127.0.0.1:1'});server.listen(0,'127.0.0.1');await once(server,'listening');try{const res=await fetch(`http://127.0.0.1:${server.address().port}/health/ready`);assert.equal(res.status,503);assert.match(JSON.stringify(await res.json()),/未连接/);}finally{await new Promise(r=>server.close(r));}});
