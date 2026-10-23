import{describe,expect,it,vi}from'vitest';
import{ConversationsController}from'../src/conversations/conversations.controller.js';
describe('005C optional quality telemetry',()=>{
 it('records only a sanitized summary after generation',async()=>{
  const record=vi.fn();const gate={acquire:()=>true,release:vi.fn()};
  const runtime={converse:async()=>({response:'最终回复',trace:{userId:'private-owner',text:'private-message',validation:{repairAttempts:1,failures:[{stage:'continuity',code:'previous_response'}],fallbackUsed:false}}})};
  const controller=new ConversationsController({}as never,{provider:'mock',model:'mock'},runtime as never,gate,{record});
  const response=await controller.sendMessage({principal:{userId:'owner'}}as never,'quality-key',{text:'private-message'});
  expect(response).toEqual({response:'最终回复'});expect(record).toHaveBeenCalledOnce();expect(JSON.stringify(record.mock.calls)).not.toMatch(/private/);expect(gate.release).toHaveBeenCalledOnce();
 });
 it('does not turn an already committed response into a failure if logging fails',async()=>{
  const controller=new ConversationsController({}as never,{provider:'mock',model:'mock'},{converse:async()=>({response:'已保存',trace:{}})}as never,undefined,{record:()=>{throw Error('log unavailable');}});
  expect(await controller.sendMessage({principal:{userId:'owner'}}as never,'quality-key',{text:'你好'})).toEqual({response:'已保存'});
 });
});
