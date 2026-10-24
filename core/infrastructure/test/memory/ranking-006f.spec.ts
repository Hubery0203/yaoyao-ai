import {describe,it,expect}from'vitest';
import {buildQueryText,rankAndSelect,DEFAULT_RANKING_WEIGHTS as W,scoreCandidate,projectSummary,type RankingCandidate}from'@yaoyao/infrastructure';
const now=new Date('2026-10-24T00:00:00Z');
const memory=(id:string,content:string,extra:Partial<RankingCandidate>={}):RankingCandidate=>({memoryId:id,content,type:'SEMANTIC',importance:.8,confidence:.9,status:'CONSOLIDATED',version:1,supersedes:null,createdAt:now,updatedAt:now,semanticScore:null,...extra});
describe('006F relevant and grounded retrieval',()=>{
 it('does not inherit an old assistant suggestion or user topic for a standalone disclosure',()=>{const q=buildQueryText({currentInput:'我喜欢白桃焙茶。',situation:{intent:'preference',urgency:'normal',taskNature:'preference'},relationshipContext:{type:'deep_partner',status:'active'},recentConversation:['User: 我想喝拿铁。','YaoYao: 你杯子多大？']});expect(q).not.toMatch(/拿铁|杯子/u);});
 it('resolves referential recall from user evidence without assistant invention',()=>{const q=buildQueryText({currentInput:'刚才那个呢？',situation:{intent:'question',urgency:'normal',taskNature:'general'},relationshipContext:{type:'deep_partner',status:'active'},recentConversation:['User: 我喜欢白桃焙茶。','YaoYao: 你爱喝咖啡。']});expect(q).toContain('白桃焙茶');expect(q).not.toContain('咖啡');});
 it('excludes unrelated explicit facts despite shared first-person scaffolding',()=>{const rows=[memory('a','用户陈述：我喜欢桂花乌龙茶。'),memory('b','用户陈述：我喜欢白桃焙茶。')];expect(rankAndSelect(rows,'我喜欢白桃焙茶。 preference',W,now,5).map(m=>m.memoryId)).toEqual(['b']);});
 it.each([['我现在住哪里？','我住在东京。'],['我叫什么？','我叫小林。'],['我喜欢喝什么？','我喜欢喝桂花乌龙茶。']])('broad recall keeps the requested facet: %s', (query,fact)=>expect(rankAndSelect([memory('a','用户陈述：'+fact)],query,W,now,5)).toHaveLength(1));
 it('does not present independent conflicting location facts as certain',()=>expect(rankAndSelect([memory('a','用户陈述：我住在东京。'),memory('b','用户陈述：我住在大阪。')],'我住哪里？',W,now,5)).toHaveLength(0));
 it('keeps a legitimate corrected chain and rejects obsolete predecessor',()=>expect(rankAndSelect([memory('a','用户陈述：我住在东京。'),memory('b','用户陈述：我住在大阪。',{supersedes:'a',version:2})],'我住哪里？',W,now,5).map(m=>m.memoryId)).toEqual(['b']));
 it('validated background is hedged and plans are not projected as experiences',()=>{expect(projectSummary(scoreCandidate(memory('a','我住在东京。',{status:'VALIDATED'}),'东京',W,now),W,200)).toContain('待核实');expect(projectSummary(scoreCandidate(memory('b','我们计划去大阪。',{type:'SHARED_LIFE'}),'大阪',W,now),W,200)).toContain('计划不代表已发生');});
});
