import {describe,it,expect,vi} from 'vitest';
import {TransactionalContextDataAdapter} from '../../apps/api/src/persona-context.adapter.js';
describe('006D context identity reuse',()=>{
 it('resolves the aggregate once per request and never caches across owners',async()=>{
  const loadOwned=vi.fn(async(userId:string)=>({userId,yaoyaoId:'y-'+userId}));const readWindow=vi.fn(async()=>({events:[]}));
  const adapter=new TransactionalContextDataAdapter({runAsUser:async(userId:string,fn:(tx:unknown)=>Promise<unknown>)=>fn({aggregates:{loadOwned},relationships:{findOwned:async()=>({owner:userId})},states:{findOwned:async()=>({owner:userId})},events:{readWindow}})} as never);
  const a=await adapter.loadPersonaData('a' as never),b=await adapter.loadPersonaData('b' as never);expect(loadOwned).toHaveBeenCalledTimes(2);expect(a.yaoyao.userId).toBe('a');expect(b.yaoyao.userId).toBe('b');expect(readWindow.mock.calls[0]).toEqual(['a','y-a',{limit:20}]);expect(readWindow.mock.calls[1]).toEqual(['b','y-b',{limit:20}]);
 });
});
