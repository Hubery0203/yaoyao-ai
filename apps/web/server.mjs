import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export function webServer({apiUrl='http://127.0.0.1:3000'}={}){
 const target=new URL(apiUrl);
 if(!['http:','https:'].includes(target.protocol)||!['localhost','127.0.0.1','[::1]'].includes(target.hostname))throw new Error('API target must be a local HTTP service');
 return createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/v1/')||path==='/health/ready'||path==='/health/live'){
   const chunks=[];let length=0;
   try{for await(const chunk of req){length+=chunk.length;if(length>102400){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'请求过大'}}));return;}chunks.push(chunk);}
    const url=new URL(target);url.pathname=path;url.search=new URL(req.url,'http://localhost').search;
    const headers={'Content-Type':'application/json'};for(const key of ['authorization','idempotency-key'])if(req.headers[key])headers[key]=req.headers[key];
    const upstream=await fetch(url,{method:req.method,headers,redirect:'error',signal:AbortSignal.timeout(125000),body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(await upstream.text());
   }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'本地后端未连接'}}));}return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
  if(!files[path]){res.writeHead(404);res.end();return;}
  try{const [file,type]=files[path];const data=await readFile(resolve(root,file));res.writeHead(200,{'Content-Type':type});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(500);res.end();}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const port=Number(process.env.WEB_PORT||4173);const server=webServer({apiUrl:process.env.YAOYAO_API_URL});server.listen(port,'127.0.0.1',()=>console.log(`YAOYAO web: http://127.0.0.1:${port}`));process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());}
