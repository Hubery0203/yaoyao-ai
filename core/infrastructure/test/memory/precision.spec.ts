import {describe,it,expect} from 'vitest';
import {memorySearchTerms,rankAndSelect,DEFAULT_RANKING_WEIGHTS as W,type RankingCandidate} from '@yaoyao/infrastructure';
const now=new Date('2026-10-26T00:00:00Z');
const memory=(id:string,content:string,extra:Partial<RankingCandidate>={}):RankingCandidate=>({memoryId:id,content,type:'SEMANTIC',importance:.8,confidence:.9,status:'CONSOLIDATED',version:1,supersedes:null,createdAt:now,updatedAt:now,semanticScore:null,...extra});
describe('memory precision: bounded subject terms',()=>{
 it('finds Chinese subjects inside a recall question and removes generic runtime tags',()=>{
  const terms=memorySearchTerms('你还记得白桃焙茶吗 recall general');
  expect(terms).toContain('白桃');expect(terms).toContain('焙茶');expect(terms).not.toContain('general');
 });
 it.each([['我住哪里？','住在'],['我叫什么？','我叫'],['我喜欢喝什么？','喜欢']])('searches the requested facet: %s',(query,term)=>expect(memorySearchTerms(query)).toContain(term));
 it('bounds untrusted input and does not turn punctuation into patterns',()=>{
  expect(memorySearchTerms('阿柏'.repeat(4000)+' % _ \\ OR 1=1').length).toBeLessThanOrEqual(16);
  expect(memorySearchTerms('咖啡 牛奶 茶叶 可乐 红茶 绿茶 苹果 香蕉 西瓜 橙子 桃子 梨子 葡萄 草莓 蓝莓 黄瓜 南瓜 豆浆')).toHaveLength(16);
  expect(memorySearchTerms(' % _ \\ ')).toEqual([]);
 });
});
describe('memory precision: confirmed facts outrank pending interpretations',()=>{
 it.each([false,true])('pending contradictory location cannot erase a confirmed one (supersedes=%s)',chain=>{
  const rows=[memory('old','用户陈述：我住在东京。'),memory('pending','用户陈述：我住在大阪。',{status:'VALIDATED',supersedes:chain?'old':null,version:2})];
  expect(rankAndSelect(rows,'我住哪里？',W,now,5).map(m=>m.memoryId)).toEqual(['old']);
 });
 it('independent consolidated contradictions remain unresolved rather than picked by freshness',()=>{
  expect(rankAndSelect([memory('a','我住在东京。'),memory('b','我住在大阪。',{updatedAt:new Date(now.getTime()+1000)})],'我住哪里？',W,now,5)).toEqual([]);
 });
 it('a consolidated correction still replaces its predecessor',()=>{
  expect(rankAndSelect([memory('a','我住在东京。'),memory('b','我住在大阪。',{supersedes:'a',version:2})],'我住哪里？',W,now,5).map(m=>m.memoryId)).toEqual(['b']);
 });
 it('a pending-only record remains hedged rather than discarded or promoted',()=>{
  const rows=rankAndSelect([memory('a','我住在大阪。',{status:'VALIDATED'})],'我住哪里？',W,now,5);
  expect(rows).toHaveLength(1);expect(rows[0].status).toBe('VALIDATED');
 });
});
