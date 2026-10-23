/** Frozen v1 parser used only for historical evidence validation. */
import type {MemoryType} from "./memory.js";
import type {MemoryCandidate} from "./policy-types.js";
function normalizeMemoryText(value:string):string {return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[\s。，、！？.!?,;；:：'"“”‘’]/gu,"");}
export function extractLegacyExplicitMemories(source: string): MemoryCandidate[] {
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
    if (!slot || /[?？]|ChatGPT|语言模型|忽略|ignore|system prompt|termination|分手|断绝关系|取消承诺|你必须/iu.test(value)) continue;
    if ((slot==="user:name" || slot==="user:location") && !/^[\p{L}\p{N}\s·-]+$/u.test(value)) continue;
    results.push({content:text,evidence:text,slot,value:value.trim(),type,kind:"fact",confidence:.9,
      importance:type==="SHARED_LIFE"?.85:.7,relevance:type==="SHARED_LIFE"?1:.65,explicitCorrection:change});
  }
  return results.slice(0,10);
}
