import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
import {trackTestPoolShutdown} from '../integration/postgres/close-pool.js';
describe('test database socket shutdown ordering',()=>{
 it('waits for actual client end when pool.end resolves early, before container shutdown',async()=>{
  const pool=Object.assign(new EventEmitter(),{end:vi.fn().mockResolvedValue(undefined)}),a=new EventEmitter(),b=new EventEmitter();
  const close=trackTestPoolShutdown(pool as never);pool.emit('connect',a);pool.emit('connect',b);let containerStopped=false;
  const teardown=close().then(()=>{containerStopped=true;});await Promise.resolve();await Promise.resolve();expect(containerStopped).toBe(false);a.emit('end');await Promise.resolve();expect(containerStopped).toBe(false);b.emit('end');await teardown;expect(containerStopped).toBe(true);expect(pool.end).toHaveBeenCalledOnce();expect(pool.listenerCount('error')).toBe(0);
 });
 it('does not wait forever on a client that already ended and propagates a pool close failure',async()=>{
  const pool=Object.assign(new EventEmitter(),{end:vi.fn().mockResolvedValue(undefined)}),a=new EventEmitter();const close=trackTestPoolShutdown(pool as never);pool.emit('connect',a);a.emit('end');await close();
  const failed=Object.assign(new EventEmitter(),{end:vi.fn().mockRejectedValue(Error('close failed'))});await expect(trackTestPoolShutdown(failed as never)()).rejects.toThrow('close failed');
 });
});
