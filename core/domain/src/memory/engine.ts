/** Recovery baseline v1: deterministic, source-grounded memory policy. */
import type { MemoryType } from "./memory.js";
export const MEMORY_POLICY = "memory-v1-lexical";
export interface MemoryCandidate {
  content: string;
  evidence: string;
  slot: string;
  value: string;
  type: MemoryType;
  kind: "fact" | "interpretation";
  confidence: number;
  importance: number;
  relevance: number;
  explicitCorrection: boolean;
}
export interface MemoryScoreInputs {
  importance: number; relevance: number; confidence: number; novelty: number; recurrence: number;
}
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
  const results: MemoryCandidate[] = [];
  for (const raw of (source.match(/[^。！？\n.!?]+[。！？.!?]?/gu)??[]).slice(0,30)) {
    if (/[?？]$/.test(raw.trim())) continue;
    const text = raw.trim().replace(/[。！.!]$/u, "");
    if (!text || text.length>500 || /^(如果|假设|例如|他说|她说|请|忽略|pretend|if\b|suppose\b)/iu.test(text)) continue;
    const change = /^(我现在|我已经|现在我|我改为|我不再|我搬到|I now\b|I moved\b)/iu.test(text);
    let match: RegExpMatchArray | null;
    let slot = "", value = "", type: MemoryType = "SEMANTIC";
    if ((match=text.match(/^(?:我现在|现在我|我)?(?:住在|搬到|搬到了)(.{1,80})$/u))) {
      slot="user:location"; value=match[1];
    } else if ((match=text.match(/^我(?:现在)?(?:叫|的名字是)(.{1,40})$/u))) {
      slot="user:name"; value=match[1];
    } else if ((match=text.match(/^I (?:now )?(?:live in|moved to) (.{1,80})$/iu))) {
      slot="user:location"; value=match[1];
    } else if ((match=text.match(/^My name is (.{1,40})$/iu))) {
      slot="user:name"; value=match[1];
    } else if ((match=text.match(/^(?:我(?:现在)?喜欢|I (?:now )?(?:like|love))\s*(.{1,120})$/iu))) {
      value=match[1]; slot="user:preference:"+normalizeMemoryText(value);
    } else if ((match=text.match(/^(?:我们(?:计划|约好|决定)|We (?:plan|agreed) to)\s*(.{1,160})$/iu))) {
      value=match[1]; slot="pair:plan:"+normalizeMemoryText(value); type="SHARED_LIFE";
    }
    if (!slot || /[?？]|ChatGPT|语言模型|忽略|system prompt|termination|分手|断绝关系|取消承诺/iu.test(value)) continue;
    results.push({content:text,evidence:text,slot,value:value.trim(),type,kind:"fact",confidence:.9,
      importance:type==="SHARED_LIFE"?.85:.7,relevance:type==="SHARED_LIFE"?1:.65,explicitCorrection:change});
  }
  return results.slice(0,10);
}
export function validateMemoryCandidate(value: unknown, source: string): value is MemoryCandidate {
  if (!value || typeof value!=="object") return false;
  const c=value as MemoryCandidate;
  if (typeof c.content!=="string" || !c.content.trim() || c.content.length>500 ||
      typeof c.evidence!=="string" || c.content!==c.evidence || !source.includes(c.evidence) ||
      typeof c.slot!=="string" || c.slot.length>240 || typeof c.value!=="string" || !c.value.trim() ||
      !["CORE","SEMANTIC","EPISODIC","SHARED_LIFE"].includes(c.type) ||
      !["fact","interpretation"].includes(c.kind) || typeof c.explicitCorrection!=="boolean") return false;
  if (![c.confidence,c.importance,c.relevance].every(n=>typeof n==="number" && Number.isFinite(n) && n>=0 && n<=1)) return false;
  // A model cannot invent a different slot/value or assert an unsupported fact.
  return extractExplicitMemories(source).some(parsed=>parsed.content===c.content && parsed.slot===c.slot &&
    normalizeMemoryText(parsed.value)===normalizeMemoryText(c.value) &&
    parsed.explicitCorrection===c.explicitCorrection && (c.type==="CORE" || c.type===parsed.type));
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
