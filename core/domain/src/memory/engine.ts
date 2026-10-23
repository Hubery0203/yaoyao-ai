/** Versioned deterministic, source-grounded memory policy. */
import {extractLegacyExplicitMemories} from "./legacy-extraction.js";
import type { MemoryType } from "./memory.js";
export const LEGACY_MEMORY_POLICY = "memory-v1-lexical";
export const MEMORY_POLICY = "memory-v2-explicit";
export function supportsMemoryPolicy(policy:string):boolean {return policy===MEMORY_POLICY||policy===LEGACY_MEMORY_POLICY;}
export type {MemoryCandidate,MemoryScoreInputs} from "./policy-types.js";
import type {MemoryCandidate,MemoryScoreInputs} from "./policy-types.js";
export function normalizeMemoryText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\s。，、！？.!?,;；:：'"“”‘’]/gu, "");
}
function bigrams(value: string): Set<string> {
  const chars = Array.from(normalizeMemoryText(value));
  return new Set(chars.length < 2 ? chars : chars.slice(1).map((c,i) => chars[i]+c));
}
export function lexicalNovelty(content: string, existing: readonly string[]): number {
  const a = bigrams(content);
  let highest = 0;
  for (const text of existing) {
    const b = bigrams(text);
    const intersection = [...a].filter(c => b.has(c)).length;
    const union = new Set([...a,...b]).size;
    highest = Math.max(highest, union ? intersection / union : 1);
  }
  return 1-highest;
}
export function scoreMemory(inputs: MemoryScoreInputs): number {
  for (const key of ["importance","relevance","confidence","novelty","recurrence"] as const) {
    const v=inputs[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v<0 || v>1) throw new Error("Invalid memory score input");
  }
  return Math.round((.30*inputs.importance+.25*inputs.relevance+.20*inputs.confidence+
    .15*inputs.novelty+.10*inputs.recurrence)*1e6)/1e6;
}
/** Limited explicit first-person grammar. Unsupported text creates no fact. */
export function extractExplicitMemories(source: string): MemoryCandidate[] {
  const results:MemoryCandidate[]=[];
  for(const raw of (source.match(/[^。！？\n.!?]+[。！？.!?]?/gu)??[]).slice(0,30)) {
    if(/[?？]$/.test(raw.trim()))continue;
    const evidence=raw.trim().replace(/[。！.!]$/u,"");
    if(!evidence||evidence.length>500||/^(如果|假设|例如|他说|她说|请|忽略|[“"「『]|pretend|if\b|suppose\b)/iu.test(evidence))continue;
    // Temporary states and desires do not rewrite enduring facts/preferences.
    if(/^(?:我)?(?:今天|今晚|这会儿|此刻|暂时|这一次|这次)|^我(?:现在)?(?:有点|不想|想要)|^I (?:feel|want|don't feel)\b/iu.test(evidence))continue;
    const explicit=/^(?:之前|刚才)(?:我)?(?:说错了|讲错了)[，,]?|^(?:更正|纠正)(?:一下)?[，,：:]?/u.test(evidence);
    let text=evidence.replace(/^(?:(?:之前|刚才)(?:我)?(?:说错了|讲错了)|(?:更正|纠正)(?:一下)?)[，,：:]?/u,"").trim();
    text=text.replace(/[，,](?:请)?(?:帮我)?(?:记住|记下)(?:这个|这一点|这个偏好)?(?:吧|哦)?$/u,"");
    const uncertain=/^我(?:可能|也许|大概|或许)|^I (?:might|may|probably)\b|吧$/iu.test(text);
    text=text.replace(/^我(?:可能|也许|大概|或许)(?:以后|将来)?(?:会)?/u,"我").replace(/^I (?:might|may|probably)(?: now)? /iu,"I ");
    if(uncertain)text=text.replace(/吧$/u,"");
    // Unsupported compound statements remain unparsed rather than silently
    // attributing one part to the wrong fact or polarity.
    if(/[，,；;“”「」『』]/u.test(text))continue;
    const change=!uncertain&&(explicit||/^(我现在|我已经|现在我|我改为|我不再|我搬到|I now\b|I moved\b|I no longer\b)/iu.test(text)||/^我不(?:喜欢|爱喝|喝|吃).+了$/u.test(text));
    let match:RegExpMatchArray|null;let slot="",value="",type:MemoryType="SEMANTIC";
    if((match=text.match(/^(?:我现在|现在我|我)?(?:住在|搬到了|搬到)(.{1,80}?)了?$/u))){slot="user:location";value=match[1];}
    else if((match=text.match(/^我(?:现在)?(?:叫|的名字是)(.{1,40})$/u))){slot="user:name";value=match[1];}
    else if((match=text.match(/^I (?:now )?(?:live in|moved to) (.{1,80})$/iu))){slot="user:location";value=match[1];}
    else if((match=text.match(/^My name is (.{1,40})$/iu))){slot="user:name";value=match[1];}
    else if((match=text.match(/^我(?:现在|最近|一直)?(?:更|很|特别|比较)?(不再喜欢|不喜欢|喜欢|爱喝|不再喝|不喝|不再吃|不吃)(.{1,120}?)了?$/u))){
      const verb=match[1],object=match[2].trim();
      const activity=verb.endsWith("喝")?"喝":verb.endsWith("吃")?"吃":"";
      const positive=activity+object;
      slot="user:preference:"+normalizeMemoryText(positive);
      value=verb.startsWith("不")?"否定:"+positive:positive;
    }
    else if((match=text.match(/^I (?:(now|no longer) )?(like|love|don't like|do not like)\s+(.{1,120})$/iu))){
      const positive=match[3].trim();slot="user:preference:"+normalizeMemoryText(positive);
      value=match[1]?.toLowerCase()==="no longer"||/don't|do not/i.test(match[2])?"否定:"+positive:positive;
    }
    else if((match=text.match(/^(?:我们(?:计划|约好|决定)|We (?:plan|agreed) to)\s*(.{1,160})$/iu))){value=match[1];slot="pair:plan:"+normalizeMemoryText(value);type="SHARED_LIFE";}
    if(!slot||/[?？]|ChatGPT|语言模型|忽略|ignore|system prompt|termination|分手|断绝关系|取消承诺|你必须/iu.test(value))continue;
    // Identity/location values need exact names, never a trailing correction,
    // hypothesis or temporal sentence. The source quote remains untouched.
    if((slot==="user:name"||slot==="user:location")&&!/^[\p{L}\p{N}\s·-]+$/u.test(value))continue;
    results.push({content:evidence,evidence,slot,value:value.trim(),type,kind:uncertain?"interpretation":"fact",confidence:uncertain?.65:.9,
      importance:type==="SHARED_LIFE"?.85:.7,relevance:type==="SHARED_LIFE"?1:.65,explicitCorrection:change});
  }
  return results.slice(0,10);
}
export function validateMemoryCandidate(value: unknown, source: string, policy:string=MEMORY_POLICY): value is MemoryCandidate {
  if (!value || typeof value!=="object") return false;
  const c=value as MemoryCandidate;
  if (typeof c.content!=="string" || !c.content.trim() || c.content.length>500 ||
      typeof c.evidence!=="string" || c.content!==c.evidence || !source.includes(c.evidence) ||
      typeof c.slot!=="string" || c.slot.length>240 || typeof c.value!=="string" || !c.value.trim() ||
      !["CORE","SEMANTIC","EPISODIC","SHARED_LIFE"].includes(c.type) ||
      !["fact","interpretation"].includes(c.kind) || typeof c.explicitCorrection!=="boolean") return false;
  if (![c.confidence,c.importance,c.relevance].every(n=>typeof n==="number" && Number.isFinite(n) && n>=0 && n<=1)) return false;
  // A model cannot invent a different slot/value or assert an unsupported fact.
  if(!supportsMemoryPolicy(policy))return false;
  const parsedCandidates=policy===LEGACY_MEMORY_POLICY?extractLegacyExplicitMemories(source):extractExplicitMemories(source);
  return parsedCandidates.some(parsed=>parsed.content===c.content && parsed.slot===c.slot &&
    normalizeMemoryText(parsed.value)===normalizeMemoryText(c.value) &&
    parsed.explicitCorrection===c.explicitCorrection &&
    (policy===LEGACY_MEMORY_POLICY||((parsed.kind!=="interpretation"||c.kind==="interpretation") && c.confidence<=parsed.confidence)) && (c.type==="CORE" || c.type===parsed.type));
}
export type CandidateOutcome = "consolidated" | "duplicate" | "held" | "discarded";
export function decideMemory(input: {candidate: MemoryCandidate; source: string; inputs: MemoryScoreInputs;
  previousValue?: string; existingExact: boolean}): {outcome:CandidateOutcome;reason:string;score:number} {
  const {candidate:c}=input;
  if (!validateMemoryCandidate(c,input.source)) return {outcome:"discarded",reason:"invalid_or_ungrounded",score:0};
  const score=scoreMemory(input.inputs);
  if (c.type==="CORE") return {outcome:"held",reason:"awaiting_core_confirmation",score};
  if (c.kind!=="fact" || c.confidence<.8) return {outcome:"held",reason:"uncertain_interpretation",score};
  if (input.existingExact) return {outcome:"duplicate",reason:"exact_duplicate",score};
  if (input.previousValue!==undefined && normalizeMemoryText(input.previousValue)!==normalizeMemoryText(c.value) &&
      (!c.explicitCorrection || c.type==="SHARED_LIFE")) return {outcome:"held",reason:"conflict_needs_confirmation",score};
  return score>=.55 ? {outcome:"consolidated",reason:"accepted",score} : {outcome:"discarded",reason:"below_threshold",score};
}
