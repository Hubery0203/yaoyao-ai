import{describe,expect,it,vi}from'vitest';
import{loadConversationHistory,type PersistenceTransaction}from'../src/index.js';
import{newUserId,newYaoYaoId}from'@yaoyao/domain';
const userId=newUserId(),yaoyaoId=newYaoYaoId(),date=new Date();
const events=[{aggregateSeq:1,event:{type:'USER_MESSAGE',correlationId:'past',payload:{text:'我喜欢喝茶'},occurredAt:date}},{aggregateSeq:2,event:{type:'ASSISTANT_MESSAGE',correlationId:'past',payload:{text:'热的还是冰的？'},occurredAt:date}},{aggregateSeq:3,event:{type:'USER_MESSAGE',correlationId:'current',payload:{text:'热的'},occurredAt:date}}];
describe('005C prior history window',()=>{
 it('passes exclusion into the bounded database query and filters defensively',async()=>{
  const readWindow=vi.fn(async()=>({events,total:3}));const tx={events:{readWindow}}as unknown as PersistenceTransaction;
  const history=await loadConversationHistory(tx,{userId,yaoyaoId,limit:2,excludeRequestId:'current'});
  expect(history.map(t=>t.text)).toEqual(['我喜欢喝茶','热的还是冰的？']);expect(readWindow.mock.calls[0]).toEqual([userId,yaoyaoId,{types:['USER_MESSAGE','ASSISTANT_MESSAGE'],limit:2,excludeRequestId:'current'}]);
 });
 it('also excludes the current request in legacy adapters',async()=>{
  const tx={events:{readOwnedAfter:async()=>events}}as unknown as PersistenceTransaction;
  expect((await loadConversationHistory(tx,{userId,yaoyaoId,limit:2,excludeRequestId:'current'})).map(t=>t.sequence)).toEqual([1,2]);
 });
});
