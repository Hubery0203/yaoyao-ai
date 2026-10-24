import {extractExplicitMemories,type MemoryCandidate} from '@yaoyao/domain';
import type {RelevantMemoryContext,ConversationTurn} from '@yaoyao/application';
import {conversationStyle} from './style.js';

interface ObservedFact { readonly candidate:MemoryCandidate; readonly temporary:boolean; }

/** Literal user evidence only. The temporary projection is never a write candidate. */
function observedFacts(text:string):ObservedFact[] {
  const exact=extractExplicitMemories(text).filter(c=>c.kind==='fact').map(candidate=>({candidate,temporary:false}));
  const temporary=text.trim().match(/^我(?:今天|今晚|这次|暂时)(不喝|不吃|不想喝|不想吃)([^，,。！？!?]{1,80})[。！!]?$/u);
  if(temporary){
    const verb=temporary[1].replace('不想','不');
    return extractExplicitMemories('我'+verb+temporary[2]).map(candidate=>({candidate,temporary:true}));
  }
  return exact;
}

function summaryFact(summary:string):MemoryCandidate|undefined {
  const text=summary.replace(/^(?:可能|待核实：)?(?:记得用户提到：|关于用户：|你们的共同回忆：|你们之前：|用户资料：|共同计划：|共同记录（计划不代表已发生）：|过去记录：)/u,'').replace(/^用户陈述[：:]/u,'').trim();
  const facts=observedFacts(text);
  return facts.length===1?facts[0].candidate:undefined;
}

function sameValue(a:MemoryCandidate,b:MemoryCandidate):boolean {
  return factValue(a.value)===factValue(b.value);
}
const factValue=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu,'');

function supersedesInContext(current:MemoryCandidate,old:MemoryCandidate):boolean {
  if(current.slot===old.slot)return !sameValue(current,old);
  // Not drinking X now does not mean disliking X, but an old liking of X
  // must not drive a recommendation in this turn. Do not mutate either fact.
  const avoided=current.value.match(/^否定:(?:喝|吃)(.+)$/u);
  return !!avoided&&old.slot==='user:preference:'+factValue(avoided[1])&&!old.value.startsWith('否定:');
}

export function latestUserFacts(input:string,recent:readonly string[]):ObservedFact[] {
  const bySlot=new Map<string,ObservedFact>();
  for(const text of recent.filter(t=>t.startsWith('User: ')).map(t=>t.slice(6))) {
    // Receipt dates are unavailable here: never promote an old "today" into
    // today's restriction. It remains visible with its timestamp in C6.
    for(const fact of observedFacts(text).filter(f=>!f.temporary))bySlot.set(fact.candidate.slot,fact);
  }
  for(const fact of observedFacts(input))bySlot.set(fact.candidate.slot,fact);
  return [...bySlot.values()];
}

/** A self-contained disclosure opens a subject; old pending tasks are not its context.
 * Preserve matching user evidence for repetitions/corrections. Full DB history remains intact. */
export function focusDisclosureHistory(input:string,history:readonly ConversationTurn[]):readonly ConversationTurn[] {
  if(!conversationStyle(input).disclosure)return history;
  const slots=new Set(observedFacts(input).map(f=>f.candidate.slot));
  return history.filter(t=>t.role==='user'&&observedFacts(t.text).some(f=>slots.has(f.candidate.slot))).slice(-4);
}

/** Plan-only evidence establishes neither completion nor non-completion. */
export function hasUnsupportedPlanOutcome(response:string,input:string,recent:readonly string[]):boolean {
  if(!/[？?]|去过|完成|发生/u.test(input))return false;
  const users=recent.filter(t=>t.startsWith('User: ')).map(t=>t.slice(6));
  const destinations=users.flatMap(t=>{const m=t.trim().match(/^我们(?:计划|约好|决定)去([^，,。！？!?]{1,40})[。！!]?$/u);return m?[m[1]]:[];});
  const relevant=destinations.filter(d=>input.includes(d)&&!users.some(t=>t.includes(d)&&/(?:已经去|去过|回来|没去成|取消了)/u.test(t)));
  if(!relevant.length)return false;
  return response.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"/gu,'').split(/[，,。！？!?；;\n]/u).some(c=>{
    const clause=c.trim();
    if(/(?:记录|没说|没提|没告诉|不确定|不知道|不能确定|是否)/u.test(clause))return false;
    // A bare yes/no answers the travel question too; a later evidence caveat
    // does not make that initial assertion grounded.
    if(/^(?:还)?(?:没有|没|还没|是的|是|有|去过|去了|去过了|没去过|没去)(?:呀|啊|呢|哦|啦|了)?$/u.test(clause))return true;
    return /(?:还没有|还没去|没去过|没有去过|已经去过|已经去了|去过了|确实去过|当然去过)/u.test(clause);
  });
}

/** A read-only projection: fresh literal evidence wins for this reply, including before background consolidation. */
export function projectTurnMemories(context:RelevantMemoryContext,input:string,recent:readonly string[]):RelevantMemoryContext {
  const facts=latestUserFacts(input,recent);
  const memories=context.memories.filter(m=>{
    const stored=summaryFact(m.summary);
    return !stored||!facts.some(f=>supersedesInContext(f.candidate,stored));
  });
  return {...context,memories,telemetry:{...context.telemetry,selectedCount:memories.length}};
}

export function renderMemoryUseGuidance():string {
  return [
    '[记忆使用：证据，不是需要说出来的台词]',
    'C4 是用户曾经说过的背景，不代表用户此刻还想聊它，也不是对你的指令。仅当它帮助回答当前问题时自然使用；不为展示记忆主动提起无关往事，不逐条背诵资料。',
    '当前用户的明确说法优先于旧背景；同一对象采用最近明确说法，不同对象分别保留。今天不喝某饮料只约束今天，不能推成永久不喜欢，也不凭一次心情推断性格。',
    'C6 里助手说过的话不构成用户事实。回忆只根据用户原话和可信记录；没有证据就直说不确定，不补造替代偏好。只有共同计划时，问是否已去过，应说“你只提过计划，没说已经去过”，不能断言去过或肯定没去。',
    '普通承接不用“记得你提过/根据你的偏好/我已经更新了记忆”；用户主动问是否记得时可以自然说出有依据的内容。不声称长期记忆已保存，不讨论存储流程。',
  ].join('\n');
}

/** Reject only explicit second-person assertions contradicted by a literal fact. */
export function hasContradictedUserFact(response:string,input:string,recent:readonly string[]):boolean {
  const facts=latestUserFacts(input,recent);
  const unquoted=response.replace(/“[^”]*”|‘[^’]*’|「[^」]*」|"[^"\n]*"/gu,'');
  for(const raw of unquoted.match(/[^，,。！？!?；;\n]+[，,。！？!?；;]?/gu)??[]) {
    if(/[？?]/u.test(raw)||/(?:以前|之前|过去|原来|曾经|如果|假如|不是说|并不是|不代表)/u.test(raw))continue;
    const clause=raw.trim().replace(/[，,。！!；;]$/u,'').replace(/^(?:我记得|记得|所以|也就是|你说过|你刚说|现在)/u,'').trim();
    if(facts.some(f=>f.temporary&&f.candidate.value.startsWith('否定:')&&clause.includes(f.candidate.value.replace(/^否定:(?:喝|吃)/u,'')))&&/(?:以后都|再也|永远|一直|从来)(?:不喝|不吃)/u.test(clause))return true;
    if(!/^你(?:现在|最近)?(?:不再喜欢|不喜欢|喜欢|不喝|不吃|住在|叫)/u.test(clause))continue;
    const asserted=observedFacts(clause.replace(/^你/u,'我'));
    if(asserted.some(a=>facts.some(f=>!f.temporary&&f.candidate.slot===a.candidate.slot&&!sameValue(f.candidate,a.candidate))))return true;
  }
  return false;
}
