import type {MemoryType} from "./memory.js";
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
