import {describe,it,expect} from 'vitest';
import type {RelevantMemoryContext} from '@yaoyao/application';
import {projectTurnMemories,hasContradictedUserFact} from '../src/conversation/memory-context.js';
const base=()=>({memories:[{memoryId:'tea',summary:'用户资料：用户陈述：我喜欢白桃焙茶。'},{memoryId:'coffee',summary:'用户资料：用户陈述：我喜欢咖啡。'}],telemetry:{selectedCount:2}})as RelevantMemoryContext;
describe('temporary memory restrictions remain turn-local',()=>{
 it.each(['今天不喝白桃焙茶。','我这会儿不想喝白桃焙茶。','此刻不喝白桃焙茶。','这一次不喝白桃焙茶。'])('suppresses only the relevant recommendation: %s',input=>{
  const original=base();const projected=projectTurnMemories(original,input,[]);
  expect(projected.memories.map(m=>m.memoryId)).toEqual(['coffee']);
  expect(original.memories).toHaveLength(2);
  expect(hasContradictedUserFact('你以后都不喝白桃焙茶。',input,[])).toBe(true);
 });
 it('does not carry a date-unknown restriction into a later turn',()=>{
  expect(projectTurnMemories(base(),'推荐点喝的',['User: 我这会儿不喝白桃焙茶。']).memories).toHaveLength(2);
 });
 it.each(['她说“今天不喝白桃焙茶”。','如果今天不喝白桃焙茶。','今天不喝白桃焙茶吗？'])('quotes, hypotheticals and questions do not become a restriction: %s',input=>{
  expect(projectTurnMemories(base(),input,[]).memories).toHaveLength(2);
 });
});
