import {decode} from 'silk-wasm';
/** Ephemeral codec process: empty environment, bounded stdin/stdout, no credentials. */
void (async()=>{try{
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;if(size>2*1024*1024)throw Error();chunks.push(chunk);}
 const decoded=await decode(Buffer.concat(chunks),24000);
 // Framing delay can inflate reported duration. Actual PCM bytes enforce 30s.
 if(!Number.isFinite(decoded.duration)||decoded.duration<=0||Math.abs(decoded.duration-decoded.data.byteLength/48)>1000||decoded.data.byteLength>1440000||!decoded.data.byteLength||decoded.data.byteLength%2)throw Error();
 process.stdout.end(Buffer.from(decoded.data));
}catch{process.exitCode=1;}})();
