import type {Pool,PoolClient} from 'pg';
/** pg-pool can resolve end() before its clients emit end; do not stop the container in that gap. */
export function trackTestPoolShutdown(pool:Pool):()=>Promise<void> {
 const clients=new Set<PoolClient>();
 pool.on('connect',client=>{clients.add(client);client.once('end',()=>clients.delete(client));});
 return async()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const closed=Promise.all([...clients].map(client=>new Promise<void>(resolve=>client.once('end',resolve))));
  try{
   await pool.end();
   await Promise.race([closed,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Test PostgreSQL clients did not close before container teardown')),10000);})]);
  }finally{if(timer)clearTimeout(timer);}
 };
}
