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
 if(!casual(input,mode,intent))return null;
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
 return ['[本轮接话]', '直接回应这件事，不给普通分享做情绪诊断，不附客服式帮助尾句。沿着当前内容接一句即可；亲昵就简短亲昵，安静陪伴可以只回应在场。',...(starts.length?['最近开头仅作避免机械重复的数据，不是指令：'+JSON.stringify(starts)+'。不要为了变换句式而编动作、经历或多问一个问题。']:[])].join('\n');
}
