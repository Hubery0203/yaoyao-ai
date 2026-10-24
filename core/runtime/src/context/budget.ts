/**
 * Token budget allocator — MVP-002B (frozen §6).
 *
 * Rules:
 * - Fill P0 → P1 → P2 → P3 until the input budget is exhausted.
 * - P0 (C0, C1, C7) is NEVER dropped — even if it alone exceeds the
 *   budget (that indicates a misconfigured budget, not a droppable layer).
 * - Truncation order on shortage: P3 → P2 → P1.
 * - Output tokens are ALWAYS reserved: input budget + reserved output ≤ total.
 * - Records layersIncluded / layersDropped / estimatedInputTokens /
 *   reservedOutputTokens / totalBudget for the trace.
 *
 * Token estimation heuristic: ASCII chars / 4, CJK chars * 1.5, other UTF-16 units. This is a rough estimate
 * for mixed Chinese/English text, documented as such. It is used ONLY
 * for budget decisions, never as a billing or limit authority.
 */
import type { ContextLayer, ContextLayerId } from "./layers.js";

export interface BudgetConfig {
  /** Total model context window available for this turn. */
  readonly totalBudget: number;
  /** Space for decision/continuity/schema guidance appended outside C0-C7. */
  readonly reservedInputOverheadTokens?:number;
  /** Tokens reserved for the model's output. Never given to input. */
  readonly reservedOutputTokens: number;
}

export interface BudgetResult {
  readonly included: ReadonlyArray<ContextLayer>;
  readonly dropped: ReadonlyArray<ContextLayerId>;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly totalBudget: number;
}

const CJK_CHARACTER=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Conservative heuristic for mixed text; not a tokenizer or billing estimate. */
export function estimateTokens(text: string): number {
  let ascii=0,cjk=0,other=0;
  for(const char of text){if((char.codePointAt(0)??0)<128)ascii++;else if(CJK_CHARACTER.test(char))cjk++;else other+=char.length;}
  return Math.max(1,Math.ceil(ascii/4+cjk*1.5+other));
}

export function makeLayer(
  id: ContextLayerId,
  priority: 0 | 1 | 2 | 3,
  content: string,
): ContextLayer {
  return { id, priority, content, estimatedTokenCost: estimateTokens(content) };
}

export function allocateBudget(
  layers: ReadonlyArray<ContextLayer>,
  config: BudgetConfig,
): BudgetResult {
  const inputBudget = config.totalBudget - config.reservedOutputTokens - (config.reservedInputOverheadTokens??0);
  if (inputBudget <= 0) {
    throw new Error("totalBudget must exceed reservedOutputTokens");
  }

  // P0 first, then P1 → P2 → P3. Stable within a priority (C-order).
  const sorted = [...layers].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );

  const included: ContextLayer[] = [];
  const dropped: ContextLayerId[] = [];
  let used = 0;

  for (const layer of sorted) {
    if (layer.priority === 0) {
      // P0: NEVER dropped, even on overrun (misconfigured budget is
      // surfaced via estimatedInputTokens > inputBudget, not by dropping).
      included.push(layer);
      used += layer.estimatedTokenCost;
      continue;
    }
    if (used + layer.estimatedTokenCost <= inputBudget) {
      included.push(layer);
      used += layer.estimatedTokenCost;
    } else {
      dropped.push(layer.id);
    }
  }

  return {
    included,
    dropped,
    estimatedInputTokens: used,
    reservedOutputTokens: config.reservedOutputTokens,
    totalBudget: config.totalBudget,
  };
}
