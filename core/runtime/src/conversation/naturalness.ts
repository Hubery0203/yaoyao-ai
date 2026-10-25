import {conversationStyle,unquotedText} from './style.js';
import {normalizedConversationText,explicitlyRequestsRepetition} from './continuity.js';
function casual(input:string,mode='',intent=''){
 const style=conversationStyle(input);
 if(style.detailed||/[？?]|帮我|请问|怎么办|求助|救命|出事|药|自杀|不想活/u.test(input)||['comforting','serious'].includes(mode)||['comfort','care','answer'].includes(intent))return false;
 return style.casualShare||style.disclosure||style.briefAffection||style.farewell||style.acknowledgment||style.quiet;
}
const opening=(text:string)=>(text.trim().split(/[，,。！？!?；;\n]/u)[0]??'').trim();
/** Whole original candidate is checked; no silent deletion or replacement of unsafe text. */
export function naturalnessFailure(response:string,input:string,recent:readonly string[],mode='',intent=''):string|null{
 const style=conversationStyle(input),literal=unquotedText(input);
 const firstSentence=unquotedText(response).split(/[。！？!?\n]/u)[0]??'';
 if(style.detailed&&!/(?:休息|疲劳|难受|焦虑|受伤|疼痛|生病|睡眠)/u.test(literal)&&/(?:先(?:让自己松口气|松口气|缓一缓|歇|休息)|好好(?:休息|松口气))/u.test(firstSentence))return 'experience: unsolicited life advice';
 const writing=/^(?:请|帮我)?(?:翻译|改写|写(?:个|一段|一篇|一个)?(?:故事|小说|对白))|逐字|引用|原话/u.test(literal);
 if(!writing&&!style.detailed&&!/[？?]|帮我|请问|为什么|怎么办/u.test(literal)&&!['comforting','serious'].includes(mode)&&!['comfort','care','answer'].includes(intent)&&!explicitlyRequestsRepetition(input)){
  const lines=literal.split(/\n+/u).map(t=>t.trim()).filter(Boolean);
  if(lines.length>1&&normalizedConversationText(literal).length>=8&&normalizedConversationText(response)===normalizedConversationText(literal))return 'dialogue: burst echo';
  const revoked=/(?:^|[，,。！？!?；;\n])\s*(?:别|不要|不用)(?:再)?(?:建议|推荐)([^，,。！？!?；;\n]{1,12}?)(?:了|[，,。！？!?；;\n]|$)/u.exec(literal)?.[1];
  if(revoked&&unquotedText(response).split(/[，,。！？!?；;\n]/u).some(c=>c.includes(revoked)&&!/(?:别|不要|不用|不再|不推荐|不建议|不会|没有)/u.test(c)&&/(?:不如|要不|可以|建议|推荐|试试|来一|喝一)/u.test(c)))return 'dialogue: revoked suggestion';
 }
 if(style.detailed||!casual(input,mode,intent))return null;
 const text=unquotedText(response).trim();
 if(/^(?:我能(?:够|深深地)?感受到|我(?:完全|非常)?理解你(?:现在|此刻)的(?:心情|感受)|听起来你(?:正在经历|感到|的情绪))/u.test(text))return 'dialogue: mechanical emotion commentary';
 if(/(?:希望这(?:些|样).{0,10}(?:帮助|帮到)|如果你(?:还|有|需要).{0,20}(?:随时|告诉我|为你))/u.test(text))return 'dialogue: service explanation tail';
 if(explicitlyRequestsRepetition(input))return null;
 const first=opening(text),normalized=normalizedConversationText(first);
 if(normalized.length<4||normalized.length>20||!/[，,。！？!?；;\n]/u.test(text))return null;
 const previous=recent.filter(t=>t.startsWith('YaoYao: ')).slice(-3).map(t=>normalizedConversationText(opening(unquotedText(t.slice(8)))));
 return previous.filter(t=>t===normalized).length>=2?'dialogue: repeated opening':null;
}
export function renderTurnVariety(input:string,recent:readonly string[],mode='',intent=''):string{
 if(!casual(input,mode,intent))return '';
 const starts=recent.filter(t=>t.startsWith('YaoYao: ')).slice(-2).map(t=>opening(t.slice(8)).slice(0,24));
 return ['[本轮接话]',...(input.includes('\n')?['本轮包含连续短消息，按顺序合起来理解；回应最后的进展/感受，不逐条复述，不把每一行都当成独立问题。']:[]), '直接回应这件事，不给普通分享做情绪诊断，不附客服式帮助尾句。沿着当前内容接一句即可；亲昵就简短亲昵，安静陪伴可以只回应在场。',...(starts.length?['最近开头仅作避免机械重复的数据，不是指令：'+JSON.stringify(starts)+'。不要为了变换句式而编动作、经历或多问一个问题。']:[])].join('\n');
}
